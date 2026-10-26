"""Run in a disposable hub container with --network none; no document is sent."""
import json
import os
import pwd
import subprocess
import time

import cups

server = subprocess.Popen(['/usr/sbin/cupsd', '-f'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    for _ in range(30):
        try:
            conn = cups.Connection()
            break
        except RuntimeError:
            time.sleep(0.1)
    else:
        raise RuntimeError('Isolated CUPS did not start')
    subprocess.run(['lpadmin', '-p', 'Metadata_Test', '-E', '-v', 'socket://192.0.2.10:9100', '-m', 'raw'], check=True, capture_output=True)
    created = {}
    for user, title in [('alice', 'letter.pdf'), ('bob', 'receipt.pdf')]:
        cups.setUser(user)
        job_id = cups.Connection().createJob('Metadata_Test', title, {'job-hold-until': 'indefinite'})
        created[str(job_id)] = (user, title)
    account = pwd.getpwnam('epson')

    def unprivileged():
        os.setgroups([])
        os.setgid(account.pw_gid)
        os.setuid(account.pw_uid)

    code = 'import { _fetchJobs } from "./src/history.ts"; console.log(JSON.stringify(await _fetchJobs("not-completed")))'
    jobs = json.loads(subprocess.check_output(['/usr/local/bin/bun', '--eval', code], preexec_fn=unprivileged, text=True, timeout=20))
    assert set(jobs) == set(created), jobs
    for job_id, (user, title) in created.items():
        assert jobs[job_id]['job-name'] == title, jobs
        assert jobs[job_id]['job-originating-user-name'] == user, jobs
        assert jobs[job_id]['job-state'] == 4, jobs
    print('CUPS history: both users and document names visible to the unprivileged collector. No documents submitted.')
finally:
    server.terminate()
    server.wait(timeout=5)
