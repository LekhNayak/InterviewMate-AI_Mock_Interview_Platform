# Deployment

The frontend, the Express API, the interview service and the ATS service run on Vercel. The emotion service runs in Docker on one server, behind Caddy, which gets HTTPS certificates automatically. `render.yaml` describes an alternative on Render.

| Hostname | Runs on | Service |
|---|---|---|
| `interviewmate.lekh.online` | Vercel | Frontend |
| `interview-backend.lekh.online` | Vercel | Express API |
| `interview-service.lekh.online` | Vercel | Interview service, called by the browser |
| `emotion.lekh.online` | Server | Emotion service, called by the browser |
| `ats.lekh.online` | Vercel | ATS service, called only by the API |

Set them up in this order: the server and the interview service, then the API, then the frontend. Each step needs the URLs of the one before it.

The interview works without the other two services. Without the emotion service the feedback has no voice reading, and without the ATS service the Resume Analyzer fails.

## The server: ATS and emotion services

These steps use an Oracle Cloud ARM machine. Any Linux server with Docker and about 4 GB of memory works the same way from step 4.

### 1. Create the machine

Create a **VM.Standard.A1.Flex** instance with 2 OCPU, 12 GB RAM and Ubuntu 22.04 or 24.04 (ARM build). Check Oracle's current Always Free limits before you create it.

If you get "Out of host capacity", try another availability domain or retry later. It is a capacity limit, not an account problem.

Save the SSH private key when prompted. You cannot download it again.

### 2. Point DNS at the machine

Add two A records with the instance's public IP: `emotion` and `ats`.

Do this before step 6. Caddy requests certificates when it starts, and the request fails if the names do not resolve yet.

### 3. Open ports 80 and 443 in both places

Oracle filters traffic at two layers.

In the **Virtual Cloud Network**, open the security list and add ingress rules with source `0.0.0.0/0` for TCP ports 80 and 443.

Then open them on the instance, because Oracle's Ubuntu images drop everything except SSH:

```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

If the security list is open and connections still hang, check these rules.

### 4. Install Docker

```bash
sudo apt-get update && sudo apt-get install -y ca-certificates curl git
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
```

Log out and back in so the group change applies.

### 5. Clone and configure

```bash
git clone https://github.com/LekhNayak/InterviewMate-AI_Mock_Interview_Platform.git interviewmate
cd interviewmate
```

Create the `.env` files from each service's `exampleENV.txt`. They are gitignored, so write them on the server. [Setup](setup.md) explains every variable.

| File | Variables |
|---|---|
| `models/Resume ATS and JD/api_service/.env` | `GROQ_API_KEY`, `GROQ_MODEL`, `SERVICE_TOKEN_SECRET` |
| `models/Audio_Emotion_Analysis/.env` | `SERVICE_TOKEN_SECRET` |

Make one `SERVICE_TOKEN_SECRET` with `openssl rand -hex 32` and use it in both files, on the interview service and on the API in Vercel. Do not leave it empty. The services are on the internet, and without it anyone can use them, and your Groq and Sarvam keys with them.

`docker-compose.yml` sets `PORT`, and its value overrides those files.

Edit `deploy/Caddyfile` and `deploy/keepalive.sh` if you use hostnames other than `emotion` and `ats` under `lekh.online`.

### 6. Start

```bash
cd deploy
docker compose up -d --build --remove-orphans
```

`--remove-orphans` stops the API container if an older version of this file ran it here. The optional `.env` of the emotion service needs Docker Compose 2.24 or later.

The first build is slow because TensorFlow and PyTorch are large. Watch it with `docker compose logs -f`, then check your own hostnames:

```bash
curl https://ats.example.com/api/health
curl https://emotion.example.com/api/health
curl -X POST https://ats.example.com/api/analyze
```

The last one must answer `401` with `Sign in to use this service`. If it answers `400`, `SERVICE_TOKEN_SECRET` is missing from the ATS service's `.env`.

### 7. Keep-alive job

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

## Vercel: the interview service

[models/Interview api_service/api/index.py](../models/Interview%20api_service/api/index.py) exposes the Flask app to Vercel, and `vercel.json` sends every path to it.

1. Import the repository as a new Vercel project. Set the root directory to `models/Interview api_service` and the framework preset to **Other**. `vercel.json` sets the install and build commands, so the folder's `package.json` does not make Vercel treat it as a Node project.
2. Add these environment variables before the first deploy:

| Variable | Value |
|---|---|
| `GROQ_API_KEY`, `GROQ_MODEL` | Groq key and `qwen/qwen3.8-27b` |
| `GROQ_API_KEY_2`, `_3`, ... | Optional backup Groq keys |
| `SARVAM_API_KEY` | Sarvam key for the interviewer's voice |
| `MONGO_URI` | The same Atlas connection string as the API. Live sessions go in the `interview_sessions` collection. |
| `SERVICE_TOKEN_SECRET` | The same value as on the API |

3. Under **Domains**, add `interview-service.lekh.online` and create the DNS record that Vercel shows.
4. Check it:

```bash
curl https://interview.example.com/api/health
```

Each request may run in a different instance, so the service keeps nothing on disk. Sessions are in MongoDB, and each reply carries the interviewer's voice as a `data:` URL instead of a link to a file. A request can be at most 4.5 MB, so a recorded answer can be about 3 minutes long, and a request can run for 60 seconds.

## Vercel: the ATS service

The same setup as the interview service. [api/index.py](../models/Resume%20ATS%20and%20JD/api_service/api/index.py) exposes the app, and `vercel.json` sets the install command, sends every path to it and leaves the optional `semantic/` engine out of the function.

1. Import the repository as a new Vercel project. Set the root directory to `models/Resume ATS and JD/api_service` and the framework preset to **Other**.
2. Add `GROQ_API_KEY` (and backup keys `GROQ_API_KEY_2`, ...), `GROQ_MODEL` = `openai/gpt-oss-120b`, and `SERVICE_TOKEN_SECRET`, the same value as on the API.
3. Under **Domains**, add `ats.lekh.online`.
4. Check it: `curl https://ats.example.com/api/health` answers `"status": "ok"` and `"semantic": false`.
5. Set `ML_SERVER` on the API to `https://ats.lekh.online` and redeploy the API.

An analysis takes about 10 seconds and makes two or three Groq calls. With one Groq key, several analyses in a row can wait on the free tier's per-minute token limit; backup keys avoid that.

The server in `deploy/` can still run the ATS service instead. Its Docker image includes the optional embedding engine.

## Vercel and the monorepo

The repository is an npm workspace with one `package-lock.json` at the root, run with Turborepo. Each Vercel project keeps its own root directory (`backend`, `frontend` or `models/Interview api_service`), and Vercel installs from the repository root by itself. Leave the install and build commands at their defaults.

Optional: under **Settings → Git → Ignored Build Step**, enter `npx turbo-ignore`. A push then redeploys a project only when its own files, or its dependencies, changed.

## Vercel: the API

Vercel runs the Express app in `backend/src/index.js` as one function. The file exports the app, and starts its own server only when run with `node`.

1. In MongoDB Atlas, under **Network Access**, allow `0.0.0.0/0`. Vercel functions do not have fixed IP addresses.
2. Import the repository as a new Vercel project. Set the root directory to `backend`. The framework preset should be detected as **Express**.
3. Add these environment variables before the first deploy:

| Variable | Value |
|---|---|
| `NODE_ENV` | `production`. Makes the login cookie `Secure` and `SameSite=None`. |
| `ML_SERVER` | `https://ats.lekh.online`, with no trailing slash |
| `SERVICE_TOKEN_SECRET` | The same value as on the Oracle machine |
| `MONGO_URI`, `SECRET_KEY` | Atlas connection string, and a long random string that signs the login cookie |
| `GROQ_API_KEY`, `GROQ_MODEL` | Groq key and `openai/gpt-oss-120b` |
| `GROQ_API_KEY_2`, `_3`, ... | Optional backup Groq keys |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Cloudinary account |
| `EMAIL_USER`, `EMAIL_PASS` | Gmail sign-up email |
| `SERPAPI_KEY` | SerpApi key for Find Jobs |
| `DEMO_EMAIL` | Account opened by the demo button. Leave empty to hide it. |

4. Under **Domains**, add `interview-backend.lekh.online` and create the DNS record that Vercel shows.
5. Check it:

```bash
curl https://api.example.com/health
```

It answers `{"server":"up","db":"connected"}`. `"disconnected"` means Atlas refused the connection: check `MONGO_URI` and the network access list.

Create the demo account once, from your own computer. Put the production `MONGO_URI` and `DEMO_EMAIL` in `backend/.env`, then run `npm run seed:demo -w backend` in the repository root.

Vercel limits:

- A request body can be at most 4.5 MB. The API accepts PDFs up to 4 MB so that it can answer with a clear error first.
- A request can run for up to 300 seconds on the Hobby plan. An ATS analysis takes well under that.

The API accepts browser requests only from the origins listed in [backend/src/index.js](../backend/src/index.js). A new frontend domain has to be added there.

## Vercel: the frontend

Import the repository again as a second project, with `frontend` as the root directory. Set these variables with the `https://` scheme:

```
VITE_API_BASE_URL=https://api.example.com/api
VITE_INTERVIEW_API=https://interview.example.com/api
VITE_EMOTION_API=https://emotion.example.com/api
```

They are built into the bundle, so redeploy after changing them. `frontend/turbo.json` passes every `VITE_*` variable to the build; a variable with another prefix would not reach it. `vercel.json` sends every path to the app so that page reloads work.

## Update

Vercel redeploys its projects when you push to the production branch.

On the server:

```bash
cd ~/interviewmate && git pull
cd deploy && docker compose up -d --build --remove-orphans
```

## Notes

- Live interview sessions are deleted from MongoDB 7 days after they start. Finished interviews are saved by the API as Interviews and stay.
- The API signs a 5-minute token for each ATS request. The browser gets 3-hour tokens for the interview and emotion services.
- To run the API in Docker yourself, build from the repository root: `docker build -f backend/Dockerfile .` The Dockerfile uses `turbo prune` to install only what the backend needs.

## Render

`render.yaml` creates the API and the three services on Render's free plan. `interviewmate-emotion-service` is built from its Dockerfile, the others run natively.

- Set the keys marked `sync: false` in the dashboard, with the same `SERVICE_TOKEN_SECRET` on all four services.
- Set `ML_SERVER` on the backend to the full URL of the ATS service after its first deploy.
- The ATS and emotion services are a tight fit in 512 MB of memory. The ATS service may run out on the first analysis, and the emotion service while it starts.
