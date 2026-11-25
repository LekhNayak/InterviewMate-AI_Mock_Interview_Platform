# Deployment

The frontend runs on Vercel. The four backend services run in Docker on one Oracle Cloud ARM machine, behind Caddy, which gets HTTPS certificates automatically. `render.yaml` describes an alternative on Render.

## 1. Create the machine

Create a **VM.Standard.A1.Flex** instance with 2 OCPU, 12 GB RAM and Ubuntu 22.04 or 24.04 (ARM build). Check Oracle's current Always Free limits before you create it.

If you get "Out of host capacity", try another availability domain or retry later. It is a capacity limit, not an account problem.

Save the SSH private key when prompted. You cannot download it again.

## 2. Point DNS at the machine

Add three A records with the instance's public IP:

| Record | Service |
|---|---|
| `api` | Express API |
| `interview` | Interview service |
| `emotion` | Emotion service |

Do this before step 5. Caddy requests certificates when it starts, and the request fails if the names do not resolve yet.

## 3. Open ports 80 and 443 in both places

Oracle filters traffic at two layers.

In the **Virtual Cloud Network**, open the security list and add ingress rules with source `0.0.0.0/0` for TCP ports 80 and 443.

Then open them on the instance, because Oracle's Ubuntu images drop everything except SSH:

```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

If the security list is open and connections still hang, check these rules.

## 4. Install Docker

```bash
sudo apt-get update && sudo apt-get install -y ca-certificates curl git
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
```

Log out and back in so the group change applies.

## 5. Clone and configure

```bash
git clone https://github.com/LekhNayak/InterviewMate-AI_Mock_Interview_Platform.git interviewmate
cd interviewmate
```

Create three `.env` files from each service's `exampleENV.txt`. They are gitignored, so write them on the server. [Setup](setup.md) explains every variable.

| File | Variables |
|---|---|
| `backend/.env` | `MONGO_URI`, `SECRET_KEY`, `GROQ_API_KEY`, `GROQ_MODEL`, `EMAIL_USER`, `EMAIL_PASS`, `RAPIDAPI_KEY`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` |
| `models/Interview api_service/.env` | `GROQ_API_KEY`, `SARVAM_API_KEY`, `GROQ_MODEL` |
| `models/Resume ATS and JD/api_service/.env` | `GROQ_API_KEY`, `GROQ_MODEL` |

`docker-compose.yml` sets `PORT`, `ML_SERVER` and `NODE_ENV`, and its values override those files. The emotion service needs no `.env`.

Edit `deploy/Caddyfile` and `deploy/keepalive.sh` if you use hostnames other than `api`, `interview` and `emotion` under `lekh.online`.

## 6. Start

```bash
cd deploy
docker compose up -d --build
docker compose exec backend mkdir -p tempUploads
```

The second command is needed after every rebuild. The image leaves out `tempUploads`, and job description uploads fail with a 500 error when that folder is missing.

The first build is slow because TensorFlow and PyTorch are large. Watch it with `docker compose logs -f`, then check your own hostnames:

```bash
curl https://api.example.com/health
curl https://emotion.example.com/api/health
```

## 7. Keep-alive job

`deploy/keepalive.sh` pings the services and keeps the CPU busy for 60 seconds. It is there because Oracle reclaims free instances that stay idle for 7 days. The thresholds are described in the script.

```bash
chmod +x ~/interviewmate/deploy/keepalive.sh
sudo touch /var/log/keepalive.log && sudo chown $USER /var/log/keepalive.log
crontab -e
```

Add this line:

```
*/10 * * * * /home/ubuntu/interviewmate/deploy/keepalive.sh >> /var/log/keepalive.log 2>&1
```

## 8. Frontend on Vercel

Import the repository with `frontend` as the root directory, and set these variables with the `https://` scheme:

```
VITE_API_BASE_URL=https://api.example.com/api
VITE_INTERVIEW_API=https://interview.example.com/api
VITE_EMOTION_API=https://emotion.example.com/api
```

They are built into the bundle, so redeploy after changing them. `vercel.json` sends every path to the app so that page reloads work.

The API accepts browser requests only from the origins listed in [backend/src/index.js](../backend/src/index.js). A new frontend domain has to be added there.

## Update

```bash
cd ~/interviewmate && git pull
cd deploy && docker compose up -d --build
docker compose exec backend mkdir -p tempUploads
```

## Notes

- The ATS service is not published by Caddy. Only the backend calls it, at `http://ats:6050` on the Docker network.
- Interview sessions, feedback files and audio live inside the container and are lost on a rebuild. Saved interviews are in MongoDB and are kept. Add a volume if you need the rest.
- The interview service stores sessions in JSON files, so run it with one worker.
- The interview and emotion services are public and have no login check.

## Render

`render.yaml` creates the same four services on Render's free plan. `interviewmate-emotion-service` is built from its Dockerfile, the others run natively.

- Set the keys marked `sync: false` in the dashboard.
- Set `ML_SERVER` on the backend to the full URL of the ATS service after its first deploy.
- The ATS and emotion services are a tight fit in 512 MB of memory. The ATS service may run out on the first analysis, and the emotion service while it starts.
