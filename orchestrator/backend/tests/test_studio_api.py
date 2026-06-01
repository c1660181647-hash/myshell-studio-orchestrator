import json
import sys
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

from main import app  # noqa: E402
from studio import PROJECTS  # noqa: E402
from studio_store import STUDIO_STORE  # noqa: E402


def _sse_events(text: str) -> list[tuple[str, dict]]:
    events: list[tuple[str, dict]] = []
    event_name = "message"
    data_lines: list[str] = []
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            if data_lines:
                events.append((event_name, json.loads("\n".join(data_lines))))
                event_name = "message"
                data_lines = []
            continue
        if line.startswith("event:"):
            event_name = line.split(":", 1)[1].strip()
        elif line.startswith("data:"):
            data_lines.append(line.split(":", 1)[1].strip())
    if data_lines:
        events.append((event_name, json.loads("\n".join(data_lines))))
    return events


class StudioApiTest(unittest.TestCase):
    def setUp(self) -> None:
        PROJECTS.clear()
        STUDIO_STORE.reset_all()
        self.client = TestClient(app)

    def test_run_stream_creates_project_and_execution_request(self) -> None:
        with self.client.stream(
            "POST",
            "/api/studio/run",
            data={
                "message": "make a cinematic clip from this portrait",
                "mode": "player",
                "action": "generate",
            },
        ) as response:
            self.assertEqual(response.status_code, 200)
            text = "".join(response.iter_text())

        events = _sse_events(text)
        names = [name for name, _payload in events]
        self.assertIn("meta", names)
        self.assertIn("route", names)
        self.assertIn("execution_request", names)
        self.assertIn("project", names)
        self.assertIn("done", names)

        execution = next(payload for name, payload in events if name == "execution_request")
        self.assertEqual(execution["executor"], "client")
        self.assertEqual(execution["api"], "dreamy-miniapp")
        self.assertTrue(execution["segmentId"].startswith("segment_"))
        self.assertTrue(execution["jobId"].startswith("job_"))
        self.assertEqual(execution["evidence"]["accepted"], False)

        project = next(payload["project"] for name, payload in events if name == "project")
        self.assertEqual(len(project["segments"]), 1)
        self.assertEqual(project["segments"][0]["status"], "queued")
        self.assertEqual(project["selectedSegmentId"], execution["segmentId"])
        self.assertEqual(project["jobs"][0]["jobId"], execution["jobId"])

    def test_client_result_updates_existing_segment(self) -> None:
        with self.client.stream(
            "POST",
            "/api/studio/run",
            data={"message": "extend this", "action": "extend"},
        ) as response:
            events = _sse_events("".join(response.iter_text()))

        meta = next(payload for name, payload in events if name == "meta")
        execution = next(payload for name, payload in events if name == "execution_request")

        update = self.client.post(
            f"/api/studio/projects/{meta['projectId']}/client-result",
            json={
                "segmentId": execution["segmentId"],
                "status": "running",
                "taskId": "job_123",
                "url": "https://example.com/result.mp4",
                "type": "video",
            },
        )

        self.assertEqual(update.status_code, 200)
        body = update.json()
        self.assertEqual(body["segment"]["taskId"], "job_123")
        self.assertEqual(body["segment"]["url"], "https://example.com/result.mp4")
        self.assertEqual(body["project"]["selectedSegmentId"], execution["segmentId"])
        self.assertEqual(body["job"]["taskId"], "job_123")

    def test_pages_agents_and_job_lifecycle_endpoints(self) -> None:
        pages = self.client.get("/api/pages")
        self.assertEqual(pages.status_code, 200)
        page_ids = {page["id"] for page in pages.json()["pages"]}
        self.assertIn("dreamy-miniapp", page_ids)
        self.assertIn("myshell-art", page_ids)

        agents = self.client.get("/api/agents")
        self.assertEqual(agents.status_code, 200)
        agent_ids = {agent["id"] for agent in agents.json()["agents"]}
        self.assertIn("evidence-verifier", agent_ids)

        with self.client.stream(
            "POST",
            "/api/studio/run",
            data={"message": "new segment"},
        ) as response:
            events = _sse_events("".join(response.iter_text()))

        execution = next(payload for name, payload in events if name == "execution_request")
        job_id = execution["jobId"]

        job = self.client.get(f"/api/studio/jobs/{job_id}")
        self.assertEqual(job.status_code, 200)
        self.assertEqual(job.json()["status"], "queued")

        cancelled = self.client.post(f"/api/studio/jobs/{job_id}/cancel")
        self.assertEqual(cancelled.status_code, 200)
        self.assertEqual(cancelled.json()["job"]["status"], "cancelled")

        retried = self.client.post(f"/api/studio/jobs/{job_id}/retry")
        self.assertEqual(retried.status_code, 200)
        self.assertEqual(retried.json()["job"]["status"], "queued")
        self.assertEqual(retried.json()["job"]["attempt"], 2)

    def test_done_without_media_is_rejected_as_error_evidence(self) -> None:
        with self.client.stream(
            "POST",
            "/api/studio/run",
            data={"message": "new segment"},
        ) as response:
            events = _sse_events("".join(response.iter_text()))

        meta = next(payload for name, payload in events if name == "meta")
        execution = next(payload for name, payload in events if name == "execution_request")

        update = self.client.post(
            f"/api/studio/projects/{meta['projectId']}/client-result",
            json={
                "segmentId": execution["segmentId"],
                "jobId": execution["jobId"],
                "status": "done",
                "taskId": "task_without_media",
            },
        )

        self.assertEqual(update.status_code, 200)
        body = update.json()
        self.assertEqual(body["segment"]["status"], "error")
        self.assertEqual(body["segment"]["evidence"]["accepted"], False)
        self.assertIn("no media URL", body["segment"]["evidence"]["message"])

    def test_project_can_be_restored_from_store_after_memory_clear(self) -> None:
        with self.client.stream(
            "POST",
            "/api/studio/run",
            data={"message": "persistent segment"},
        ) as response:
            events = _sse_events("".join(response.iter_text()))

        project_id = next(payload["projectId"] for name, payload in events if name == "meta")
        PROJECTS.clear()

        restored = self.client.get(f"/api/studio/projects/{project_id}")
        self.assertEqual(restored.status_code, 200)
        body = restored.json()
        self.assertEqual(body["projectId"], project_id)
        self.assertEqual(len(body["segments"]), 1)
        self.assertEqual(len(body["jobs"]), 1)

    def test_reset_project_removes_in_memory_state(self) -> None:
        with self.client.stream(
            "POST",
            "/api/studio/run",
            data={"message": "new segment"},
        ) as response:
            events = _sse_events("".join(response.iter_text()))

        project_id = next(payload["projectId"] for name, payload in events if name == "meta")
        self.assertIn(project_id, PROJECTS)

        reset = self.client.post(f"/api/studio/projects/{project_id}/reset")
        self.assertEqual(reset.status_code, 200)
        self.assertNotIn(project_id, PROJECTS)
        self.assertEqual(self.client.get(f"/api/studio/projects/{project_id}").status_code, 404)


if __name__ == "__main__":
    unittest.main()
