#!/usr/bin/env bash
# Defeats Oracle Cloud's idle-instance reclamation.
#
# Oracle reclaims an Always Free A1 instance only when, across a 7-day window,
# CPU (p95) AND network AND memory are all below 20%. Clearing any single one
# is enough, so this does two cheap things: warms the services over the network,
# and holds CPU above the percentile threshold.
#
# The p95 rule means CPU only has to be busy for >5% of samples to clear it;
# 60s of work every 10 minutes is a 10% duty cycle, which leaves margin.
#
# Install (as the ubuntu user on the VM):
#   chmod +x ~/interviewmate/deploy/keepalive.sh
#   crontab -e
#   */10 * * * * /home/ubuntu/interviewmate/deploy/keepalive.sh >> /var/log/keepalive.log 2>&1

set -uo pipefail

BURN_SECONDS="${BURN_SECONDS:-60}"
HOSTS=(
	"https://ats.lekh.online/api/health"
)

for url in "${HOSTS[@]}"; do
	code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 30 "$url" || echo "000")
	echo "$(date -Is) ping $url -> $code"
done

# sha256sum on /dev/zero spins a core until timeout kills it. No extra packages,
# and it stays on one core so the second OCPU is left free to serve requests.
timeout "$BURN_SECONDS" sha256sum /dev/zero >/dev/null 2>&1 || true
echo "$(date -Is) cpu burn ${BURN_SECONDS}s done"
