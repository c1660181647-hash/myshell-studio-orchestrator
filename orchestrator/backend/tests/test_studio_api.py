import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

from main import app  # noqa: E402
from studio import PROJECTS  # noqa: E402
from studio_registry import page_for_dispatch  # noqa: E402
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

    def test_health_reports_delivery_components(self) -> None:
        health = self.client.get("/api/health")
        self.assertEqual(health.status_code, 200)
        body = health.json()
        self.assertIn(body["status"], {"ok", "degraded"})
        self.assertIn("checkedAt", body)

        components = body["components"]
        for component_id in (
            "backend",
            "storage",
            "chromeCdp",
            "myshellCookies",
            "cookieInjection",
            "dreamyApiAuth",
        ):
            self.assertIn(component_id, components)
            self.assertIn("status", components[component_id])

    def test_pages_cover_existing_myshell_miniapp_routes(self) -> None:
        pages = self.client.get("/api/pages")
        self.assertEqual(pages.status_code, 200)

        page_by_id = {page["id"]: page for page in pages.json()["pages"]}
        expected_routes = {
            "explore": "/",
            "ai-picks": "/ai-picks",
            "bot-detail": "/bot",
            "upload": "/upload",
            "tag-generator": "/tag-generator",
            "library": "/library",
            "energy-store": "/energy",
            "earn": "/earn",
            "share-invite": "/share-invite",
            "settings": "/settings",
            "checkin": "/checkin-demo",
        }

        for page_id, route in expected_routes.items():
            self.assertIn(page_id, page_by_id)
            self.assertEqual(page_by_id[page_id]["appRoute"], route)
            self.assertEqual(page_by_id[page_id]["executor"], "navigation")
            self.assertEqual(page_by_id[page_id]["registrySource"], "manifest")

    def test_manifest_pages_extend_registry_and_prompt_routing(self) -> None:
        manifest = {
            "version": "test",
            "pages": [
                {
                    "id": "daily-boost",
                    "name": "Daily Boost",
                    "appRoute": "/daily-boost",
                    "capabilities": ["boost-status", "boost-claim"],
                    "intentKeywords": ["daily boost", "boost reward"],
                }
            ],
        }

        with tempfile.TemporaryDirectory() as tmp_dir:
            manifest_path = Path(tmp_dir) / "pages.json"
            manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
            with patch.dict(os.environ, {"STUDIO_PAGES_MANIFEST": str(manifest_path)}):
                pages = self.client.get("/api/pages")
                self.assertEqual(pages.status_code, 200)
                page_by_id = {page["id"]: page for page in pages.json()["pages"]}

                self.assertIn("daily-boost", page_by_id)
                self.assertEqual(page_by_id["daily-boost"]["appRoute"], "/daily-boost")
                self.assertEqual(page_by_id["daily-boost"]["registrySource"], "manifest")

                inferred = page_for_dispatch({}, "dreamy-miniapp", "open daily boost rewards")
                self.assertEqual(inferred["id"], "daily-boost")

    def test_manifest_route_defaults_are_added_to_navigation_path(self) -> None:
        manifest = {
            "version": "test",
            "pages": [
                {
                    "id": "daily-boost",
                    "name": "Daily Boost",
                    "appRoute": "/daily-boost?tab=home",
                    "capabilities": ["boost-status", "boost-claim"],
                    "intentKeywords": ["daily boost"],
                    "routeDefaults": {
                        "source": "studio",
                        "surface": "boost center",
                    },
                }
            ],
        }

        with tempfile.TemporaryDirectory() as tmp_dir:
            manifest_path = Path(tmp_dir) / "pages.json"
            manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
            with patch.dict(os.environ, {"STUDIO_PAGES_MANIFEST": str(manifest_path)}):
                with self.client.stream(
                    "POST",
                    "/api/studio/run",
                    data={"message": "open daily boost"},
                ) as response:
                    self.assertEqual(response.status_code, 200)
                    events = _sse_events("".join(response.iter_text()))

        execution = next(payload for name, payload in events if name == "execution_request")
        self.assertEqual(execution["api"], "daily-boost")
        self.assertEqual(
            execution["navigationPath"],
            "/daily-boost?tab=home&source=studio&surface=boost+center",
        )

    def test_navigation_page_dispatch_returns_navigation_execution(self) -> None:
        with self.client.stream(
            "POST",
            "/api/studio/run",
            data={"message": "open my generated library", "page_id": "library"},
        ) as response:
            self.assertEqual(response.status_code, 200)
            events = _sse_events("".join(response.iter_text()))

        route = next(payload for name, payload in events if name == "route")
        execution = next(payload for name, payload in events if name == "execution_request")
        job_payloads = [payload["job"] for name, payload in events if name == "job"]

        self.assertEqual(route["page"]["id"], "library")
        self.assertEqual(execution["executor"], "navigation")
        self.assertEqual(execution["clientAction"], "navigate")
        self.assertEqual(execution["navigationPath"], "/library")
        self.assertEqual(execution["studioReturnPath"], "/dreamy")
        self.assertEqual(execution["page"]["appRoute"], "/library")
        self.assertEqual(job_payloads[-1]["status"], "done")
        self.assertEqual(job_payloads[-1]["evidence"]["accepted"], True)

    def test_run_stream_preserves_selected_agent_id_through_retry(self) -> None:
        with self.client.stream(
            "POST",
            "/api/studio/run",
            data={"message": "plan this segment", "agent_id": "asset-planner"},
        ) as response:
            self.assertEqual(response.status_code, 200)
            events = _sse_events("".join(response.iter_text()))

        route = next(payload for name, payload in events if name == "route")
        execution = next(payload for name, payload in events if name == "execution_request")
        job = next(payload["job"] for name, payload in events if name == "job")

        self.assertEqual(route["agentId"], "asset-planner")
        self.assertEqual(execution["agentId"], "asset-planner")
        self.assertEqual(job["agentId"], "asset-planner")

        retry = self.client.post(f"/api/studio/jobs/{execution['jobId']}/retry")
        self.assertEqual(retry.status_code, 200)
        body = retry.json()
        self.assertEqual(body["job"]["agentId"], "asset-planner")
        self.assertEqual(body["executionRequest"]["agentId"], "asset-planner")

    def test_default_run_infers_navigation_page_from_prompt(self) -> None:
        with self.client.stream(
            "POST",
            "/api/studio/run",
            data={"message": "open my generated library"},
        ) as response:
            self.assertEqual(response.status_code, 200)
            events = _sse_events("".join(response.iter_text()))

        route = next(payload for name, payload in events if name == "route")
        execution = next(payload for name, payload in events if name == "execution_request")
        job_payloads = [payload["job"] for name, payload in events if name == "job"]

        self.assertEqual(route["page"]["id"], "library")
        self.assertEqual(execution["executor"], "navigation")
        self.assertEqual(execution["navigationPath"], "/library")
        self.assertEqual(job_payloads[-1]["status"], "done")

    def test_explicit_navigation_page_selection_wins_over_prompt_inference(self) -> None:
        with self.client.stream(
            "POST",
            "/api/studio/run",
            data={"message": "open my generated library", "page_id": "upload"},
        ) as response:
            self.assertEqual(response.status_code, 200)
            events = _sse_events("".join(response.iter_text()))

        route = next(payload for name, payload in events if name == "route")
        execution = next(payload for name, payload in events if name == "execution_request")

        self.assertEqual(route["page"]["id"], "upload")
        self.assertEqual(execution["executor"], "navigation")
        self.assertTrue(execution["navigationPath"].startswith("/upload?slug_id="), execution["navigationPath"])

    def test_contextual_navigation_pages_include_required_query_params(self) -> None:
        expected = {
            "bot-detail": "/bot?slug_id=",
            "upload": "/upload?slug_id=",
            "tag-generator": "/tag-generator?slug_id=",
        }

        for page_id, prefix in expected.items():
            with self.subTest(page_id=page_id):
                with self.client.stream(
                    "POST",
                    "/api/studio/run",
                    data={"message": "open this tattoo generator", "page_id": page_id},
                ) as response:
                    self.assertEqual(response.status_code, 200)
                    events = _sse_events("".join(response.iter_text()))

                execution = next(payload for name, payload in events if name == "execution_request")
                self.assertEqual(execution["executor"], "navigation")
                self.assertTrue(execution["navigationPath"].startswith(prefix), execution["navigationPath"])
                self.assertIn(execution["botSlug"], execution["navigationPath"])

    def test_project_and_job_queue_endpoints_include_evidence_trail(self) -> None:
        with self.client.stream(
            "POST",
            "/api/studio/run",
            data={"message": "queue evidence segment"},
        ) as response:
            events = _sse_events("".join(response.iter_text()))

        meta = next(payload for name, payload in events if name == "meta")
        execution = next(payload for name, payload in events if name == "execution_request")

        projects = self.client.get("/api/studio/projects")
        self.assertEqual(projects.status_code, 200)
        project_ids = [project["projectId"] for project in projects.json()["projects"]]
        self.assertIn(meta["projectId"], project_ids)

        jobs = self.client.get("/api/studio/jobs", params={"status": "queued"})
        self.assertEqual(jobs.status_code, 200)
        queued_job = next(job for job in jobs.json()["jobs"] if job["jobId"] == execution["jobId"])
        self.assertEqual(queued_job["projectId"], meta["projectId"])
        self.assertEqual(queued_job["evidenceTrail"][0]["status"], "queued")

        evidence = self.client.get(f"/api/studio/jobs/{execution['jobId']}/evidence")
        self.assertEqual(evidence.status_code, 200)
        self.assertEqual(evidence.json()["evidence"][0]["status"], "queued")

    def test_job_queue_can_filter_by_page_and_agent(self) -> None:
        with self.client.stream(
            "POST",
            "/api/studio/run",
            data={"message": "queue planner job", "agent_id": "asset-planner"},
        ) as response:
            planner_events = _sse_events("".join(response.iter_text()))
        with self.client.stream(
            "POST",
            "/api/studio/run",
            data={"message": "open my generated library", "page_id": "library"},
        ) as response:
            library_events = _sse_events("".join(response.iter_text()))

        planner_job_id = next(payload for name, payload in planner_events if name == "execution_request")["jobId"]
        library_job_id = next(payload for name, payload in library_events if name == "execution_request")["jobId"]

        by_agent = self.client.get("/api/studio/jobs", params={"agent_id": "asset-planner"})
        self.assertEqual(by_agent.status_code, 200)
        self.assertEqual([job["jobId"] for job in by_agent.json()["jobs"]], [planner_job_id])

        by_page = self.client.get("/api/studio/jobs", params={"page_id": "library"})
        self.assertEqual(by_page.status_code, 200)
        self.assertEqual([job["jobId"] for job in by_page.json()["jobs"]], [library_job_id])

        combined = self.client.get(
            "/api/studio/jobs",
            params={"page_id": "library", "agent_id": "asset-planner"},
        )
        self.assertEqual(combined.status_code, 200)
        self.assertEqual(combined.json()["jobs"], [])

    def test_retry_returns_client_execution_request(self) -> None:
        with self.client.stream(
            "POST",
            "/api/studio/run",
            data={"message": "retryable segment"},
        ) as response:
            events = _sse_events("".join(response.iter_text()))

        execution = next(payload for name, payload in events if name == "execution_request")
        retry = self.client.post(f"/api/studio/jobs/{execution['jobId']}/retry")

        self.assertEqual(retry.status_code, 200)
        body = retry.json()
        self.assertEqual(body["job"]["attempt"], 2)
        self.assertEqual(body["job"]["status"], "queued")
        self.assertEqual(body["executionRequest"]["executor"], "client")
        self.assertEqual(body["executionRequest"]["jobId"], execution["jobId"])
        self.assertEqual(body["executionRequest"]["segmentId"], execution["segmentId"])
        self.assertEqual(body["executionRequest"]["segment"]["status"], "queued")

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
