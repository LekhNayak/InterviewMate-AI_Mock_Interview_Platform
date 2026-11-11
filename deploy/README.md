# Deploying InterViewMate on Oracle Cloud (Always Free)

Runs all four backend services on a single Ampere A1 VM, behind Caddy with
automatic HTTPS. The frontend stays on Vercel.

## 1. Provision the VM

Create a **VM.Standard.A1.Flex** instance: 2 OCPU, 12 GB RAM, Ubuntu 22.04 or
24.04 (ARM build). That is the full Always Free allocation — staying at or under
it means the account is never billed.

> A1 capacity is frequently exhausted in popular regions. If you get
> "Out of host capacity", try a different availability domain, or retry later —
> it is a capacity limit, not an account problem.

Save the SSH private key when prompted; you cannot download it again.

## 2. Point DNS at the VM

Add three A records for the instance's public IP:

| Record | Points to |
|---|---|
| `api` | VM public IP |
| `interview` | VM public IP |
| `emotion` | VM public IP |

**Do this before step 5.** Caddy requests certificates on startup, and the
Let's Encrypt challenge fails if the names don't yet resolve.

## 3. Open ports 80 and 443 — in *both* places

This is the step that traps most people. Oracle filters traffic at two layers
and you must open both.

**Virtual Cloud Network → Security List → Add Ingress Rules**, source
`0.0.0.0/0`, TCP ports 80 and 443.

**Then on the instance itself**, because Oracle's Ubuntu images ship an iptables
ruleset that drops everything except SSH:

```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

If the security list is open but connections still hang, it is always this.

## 4. Install Docker

```bash
sudo apt-get update && sudo apt-get install -y ca-certificates curl git
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
```

Log out and back in so the group change applies.

## 5. Clone and configure

```bash
git clone https://github.com/LekhNayak/EFOS-Hackathon-InterviewMate.git
cd EFOS-Hackathon-InterviewMate
```

Create the three `.env` files — they are gitignored, so they must be written on
the server. Copy each service's `exampleENV.txt` and fill in real values:

- `backend/.env` — `MONGO_URI`, `SECRET_KEY`, `GROQ_API_KEY`, `GROQ_MODEL`,
  `EMAIL_USER`, `EMAIL_PASS`, `RAPIDAPI_KEY`, `CLOUDINARY_*`
- `models/Interview api_service/.env` — `GROQ_API_KEY`, `SARVAM_API_KEY`, `GROQ_MODEL`
- `models/Resume ATS and JD/api_service/.env` — `GROQ_API_KEY`, `GROQ_MODEL`

`PORT` and `ML_SERVER` are set by `docker-compose.yml` and override whatever
those files contain, so their values there don't matter.

The emotion service needs no `.env`.

Edit `deploy/Caddyfile` if you're using different hostnames than
`api/interview/emotion.lekh.online`.

## 6. Start everything

```bash
cd deploy
docker compose up -d --build
```

First build takes a while — TensorFlow and torch are large ARM wheels. Watch with:

```bash
docker compose logs -f
```

Verify:

```bash
curl https://api.lekh.online/health
curl https://emotion.lekh.online/api/health
```

## 7. Install the keep-alive cron

Oracle reclaims instances idle on CPU, network *and* memory for 7 days. Running
four services likely keeps memory above the threshold on its own, but this is
cheap insurance and also keeps the services warm:

```bash
chmod +x ~/EFOS-Hackathon-InterviewMate/deploy/keepalive.sh
sudo touch /var/log/keepalive.log && sudo chown $USER /var/log/keepalive.log
crontab -e
```

Add:

```
*/10 * * * * /home/ubuntu/EFOS-Hackathon-InterviewMate/deploy/keepalive.sh >> /var/log/keepalive.log 2>&1
```

## 8. Repoint the frontend

In the Vercel project settings, set — **with the `https://` scheme**:

```
VITE_API_BASE_URL=https://api.lekh.online/api
VITE_INTERVIEW_API=https://interview.lekh.online/api
VITE_EMOTION_API=https://emotion.lekh.online/api
```

Redeploy the frontend. No backend CORS change is needed — the allowed origins
are the Vercel/`interviewmate.lekh.online` frontend domains, which haven't moved.

## Updating after a push

```bash
cd ~/EFOS-Hackathon-InterviewMate && git pull
cd deploy && docker compose up -d --build
```

## Notes

- The ATS service is deliberately not exposed publicly. Only the backend calls
  it, over the Docker network at `http://ats:6050`.
- Interview audio in `static/recordings` lives in the container and is lost on
  rebuild. That matches the previous behaviour; add a volume if you need it kept.
- `render.yaml` in the repo root is an unused alternative deployment. Harmless
  to leave, and a fallback if you ever want push-to-deploy hosting.
