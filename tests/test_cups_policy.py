from pathlib import Path


POLICY = (Path(__file__).resolve().parents[1] / "config" / "cupsd.conf").read_text(encoding="utf-8")


def test_cups_policy_denies_unlisted_operations():
    all_limit = POLICY.split("<Limit All>", 1)[1].split("</Limit>", 1)[0]

    assert "Order allow,deny" in all_limit
    assert "Deny all" in all_limit


def test_cups_policy_explicitly_allows_lan_printing():
    print_limit = POLICY.split("<Limit Create-Job", 1)[1].split("</Limit>", 1)[0]

    assert "Send-Document" in print_limit
    assert "Deny all" in print_limit
    assert "Allow @LOCAL" in print_limit


def test_cups_policy_restricts_job_mutation_to_local_dashboard_or_authenticated_owner():
    job_limit = POLICY.split("<Limit Cancel-Job", 1)[1].split("</Limit>", 1)[0]

    assert "Deny all" in job_limit
    assert "Allow localhost" in job_limit
    assert "Require user @OWNER @SYSTEM" in job_limit
