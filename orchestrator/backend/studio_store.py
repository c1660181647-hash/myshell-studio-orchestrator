from __future__ import annotations

import json
import os
import sqlite3
import threading
from typing import Any


DEFAULT_STORE_PATH = os.path.join(os.path.dirname(__file__), ".studio", "studio.sqlite3")


class StudioStore:
    def __init__(self, path: str | None = None) -> None:
        self.path = path or os.environ.get("STUDIO_STORE_PATH") or DEFAULT_STORE_PATH
        self._lock = threading.RLock()
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        self._ensure_schema()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path)
        conn.row_factory = sqlite3.Row
        return conn

    def _ensure_schema(self) -> None:
        with self._lock, self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS projects (
                    id TEXT PRIMARY KEY,
                    payload TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS jobs (
                    id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL,
                    segment_id TEXT NOT NULL,
                    payload TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )
            conn.execute("CREATE INDEX IF NOT EXISTS idx_jobs_project_id ON jobs(project_id)")

    def save_project(self, project: dict[str, Any]) -> None:
        with self._lock, self._connect() as conn:
            conn.execute(
                """
                INSERT INTO projects(id, payload, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at
                """,
                (project["projectId"], json.dumps(project, ensure_ascii=False), project.get("updatedAt", "")),
            )

    def get_project(self, project_id: str) -> dict[str, Any] | None:
        with self._lock, self._connect() as conn:
            row = conn.execute("SELECT payload FROM projects WHERE id = ?", (project_id,)).fetchone()
        return json.loads(row["payload"]) if row else None

    def delete_project(self, project_id: str) -> None:
        with self._lock, self._connect() as conn:
            conn.execute("DELETE FROM projects WHERE id = ?", (project_id,))
            conn.execute("DELETE FROM jobs WHERE project_id = ?", (project_id,))

    def save_job(self, job: dict[str, Any]) -> None:
        with self._lock, self._connect() as conn:
            conn.execute(
                """
                INSERT INTO jobs(id, project_id, segment_id, payload, updated_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    project_id=excluded.project_id,
                    segment_id=excluded.segment_id,
                    payload=excluded.payload,
                    updated_at=excluded.updated_at
                """,
                (
                    job["jobId"],
                    job["projectId"],
                    job["segmentId"],
                    json.dumps(job, ensure_ascii=False),
                    job.get("updatedAt", ""),
                ),
            )

    def get_job(self, job_id: str) -> dict[str, Any] | None:
        with self._lock, self._connect() as conn:
            row = conn.execute("SELECT payload FROM jobs WHERE id = ?", (job_id,)).fetchone()
        return json.loads(row["payload"]) if row else None

    def find_job_by_segment(self, project_id: str, segment_id: str) -> dict[str, Any] | None:
        with self._lock, self._connect() as conn:
            row = conn.execute(
                """
                SELECT payload FROM jobs
                WHERE project_id = ? AND segment_id = ?
                ORDER BY updated_at DESC
                LIMIT 1
                """,
                (project_id, segment_id),
            ).fetchone()
        return json.loads(row["payload"]) if row else None

    def list_jobs(self, project_id: str | None = None) -> list[dict[str, Any]]:
        query = "SELECT payload FROM jobs"
        params: tuple[Any, ...] = ()
        if project_id:
            query += " WHERE project_id = ?"
            params = (project_id,)
        query += " ORDER BY updated_at DESC"
        with self._lock, self._connect() as conn:
            rows = conn.execute(query, params).fetchall()
        return [json.loads(row["payload"]) for row in rows]

    def reset_all(self) -> None:
        with self._lock, self._connect() as conn:
            conn.execute("DELETE FROM projects")
            conn.execute("DELETE FROM jobs")


STUDIO_STORE = StudioStore()
