# Deployment

The frontend and the Express API run on Vercel. The three Python services run in Docker on one Oracle Cloud ARM machine, behind Caddy, which gets HTTPS certificates automatically. `render.yaml` describes an alternative on Render.

| Hostname | Runs on | Service |
|---|---|---|
| `interviewmate.lekh.online` | Vercel | Frontend |
| `api.lekh.online` | Vercel | Express API |
| `interview.lekh.online` | Oracle | Interview service, called by the browser |
| `emotion.lekh.online` | Oracle | Emotion service, called by the browser |
| `ats.lekh.online` | Oracle | ATS service, called only by the API |

Set them up in this order: Oracle, then the API, then the frontend. Each step needs the URLs of the one before it.

## Oracle Cloud: the three services

### 1. Create the machine

Create a **VM.Standard.A1.Flex** instance with 2 OCPU, 12 GB RAM and Ubuntu 22.04 or 24.04 (ARM build). Check Oracle's current Always Free limits before you create it.

If you get "Out of host capacity", try another availability domain or retry later. It is a capacity limit, not an account problem.

Save the SSH private key when prompted. You cannot download it again.

### 2. Point DNS at the machine

Add three A records with the instance's public IP: `interview`, `emotion` and `ats`.

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
| `models/Interview api_service/.env` | `GROQ_API_KEY`, `SARVAM_API_KEY`, `GROQ_MODEL`, `SERVICE_TOKEN_SECRET` |
| `models/Resume ATS and JD/api_service/.env` | `GROQ_API_KEY`, `GROQ_MODEL`, `SERVICE_TOKEN_SECRET` |
| `models/Audio_Emotion_Analysis/.env` | `SERVICE_TOKEN_SECRET` |

Make one `SERVICE_TOKEN_SECRET` with `openssl rand -hex 32` and use it in all three files and on the API in Vercel. Do not leave it empty. All three services are on the internet, and without it anyone can use them, and your Groq and Sarvam keys with them.

`docker-compose.yml` sets `PORT`, and its value overrides those files.

Edit `deploy/Caddyfile` and `deploy/keepalive.sh` if you use hostnames other than `interview`, `emotion` and `ats` under `lekh.online`.

### 6. Start

```bash
cd deploy
docker compose up -d --build --remove-orphans
```

`--remove-orphans` stops the API container if an older version of this file ran it here. The optional `.env` of the emotion service needs Docker Compose 2.24 or later.

The first build is slow because TensorFlow and PyTorch are large. Watch it with `docker compose logs -f`, then check your own hostnames:

```bash
curl https://interview.example.com/api/health
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

## Vercel and the monorepo

The repository is an npm workspace with one `package-lock.json` at the root, run with Turborepo. Each Vercel project keeps its own root directory (`backend` or `frontend`), and Vercel installs from the repository root by itself. Leave the install and build commands at their defaults.

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
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Cloudinary account |
| `EMAIL_USER`, `EMAIL_PASS`, `RAPIDAPI_KEY` | Gmail sign-up email and job search |
| `DEMO_EMAIL` | Account opened by the demo button. Leave empty to hide it. |

4. Under **Domains**, add `api.lekh.online` and create the DNS record that Vercel shows.
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

Vercel redeploys both projects when you push to the production branch.

On the Oracle machine:

```bash
cd ~/interviewmate && git pull
cd deploy && docker compose up -d --build --remove-orphans
```

## Notes

- Interview sessions and feedback are JSON files in the `interview_data` volume, so a rebuild does not end an interview in progress. The question audio is inside the container and is lost on a rebuild. Saved interviews are in MongoDB.
- The interview service stores sessions in JSON files, so run it with one worker.
- The API signs a 5-minute token for each ATS request. The browser gets 3-hour tokens for the interview and emotion services.
- To run the API in Docker yourself, build from the repository root: `docker build -f backend/Dockerfile .` The Dockerfile uses `turbo prune` to install only what the backend needs.

## Render

`render.yaml` creates the API and the three services on Render's free plan. `interviewmate-emotion-service` is built from its Dockerfile, the others run natively.

- Set the keys marked `sync: false` in the dashboard, with the same `SERVICE_TOKEN_SECRET` on all four services.
- Set `ML_SERVER` on the backend to the full URL of the ATS service after its first deploy.
- The ATS and emotion services are a tight fit in 512 MB of memory. The ATS service may run out on the first analysis, and the emotion service while it starts.
