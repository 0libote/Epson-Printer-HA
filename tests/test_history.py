from app import history


def test_source_classification():
    assert history._source_for("webui", "localhost") == "WebUI"
    assert history._source_for("root", "127.0.0.1") == "WebUI"
    assert history._source_for("alice", "192.0.2.25") == "Network device"


def test_history_sync_persists_jobs(monkeypatch, tmp_path):
    monkeypatch.setattr(history, "APP_DIR", tmp_path)
    monkeypatch.setattr(history, "HISTORY_DB", tmp_path / "history.sqlite3")
    monkeypatch.setattr(history, "cups", object())

    pending = {
        42: {
            "job-printer-uri": "ipp://localhost/printers/Home_Epson_XP2200",
            "job-state": 5,
            "job-name": "windows-test.pdf",
            "job-originating-user-name": "alice",
            "job-originating-host-name": "192.0.2.25",
            "job-k-octets": 12,
            "job-impressions": 2,
            "time-at-creation": 1000,
        }
    }
    monkeypatch.setattr(history, "_fetch_jobs", lambda which: pending if which == "not-completed" else {})

    assert history.sync_print_history("Home_Epson_XP2200") == 1
    rows = history.list_print_history()
    assert len(rows) == 1
    assert rows[0]["job_id"] == 42
    assert rows[0]["document"] == "windows-test.pdf"
    assert rows[0]["source"] == "Network device"
    assert rows[0]["origin_host"] == "192.0.2.25"
    assert rows[0]["state"] == "printing"
    assert rows[0]["size_bytes"] == 12 * 1024
