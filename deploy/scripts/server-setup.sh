#!/usr/bin/env bash
# One-time preparation of a fresh Ubuntu 24.04 server for Yayatoh (ADR 0024,
# docs/runbooks/deploy-contabo.md). Run as root:  bash server-setup.sh
# Safe to run again: every step checks before it changes anything.
set -euo pipefail

[[ $EUID -eq 0 ]] || { echo "Run as root." >&2; exit 1; }
. /etc/os-release
[[ "${ID}" == "ubuntu" && "${VERSION_ID}" == "24.04" ]] || { echo "Ubuntu 24.04 expected, found ${PRETTY_NAME}." >&2; exit 1; }

REPO_URL=https://github.com/heywebbuddy/yayatoh.git
SRC=/opt/yayatoh/src
DEPLOY_USER=deploy

echo "==> System updates and base packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get -y upgrade
apt-get install -y ca-certificates curl gnupg git ufw fail2ban unattended-upgrades jq apt-transport-https

echo "==> Automatic security updates"
dpkg-reconfigure -f noninteractive unattended-upgrades

echo "==> Firewall: SSH, HTTP, HTTPS (and HTTP/3) only"
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

echo "==> Swap (4 GB) for build or memory spikes"
if ! swapon --show | grep -q .; then
  fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "==> Docker Engine (official repository)"
if ! command -v docker >/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
systemctl enable --now docker

echo "==> Doppler CLI (secrets come from Doppler at deploy time)"
if ! command -v doppler >/dev/null; then
  curl -sLf --retry 3 --tlsv1.2 --proto "=https" 'https://packages.doppler.com/public/cli/gpg.DE2A7741A397C129.key' \
    | gpg --dearmor -o /usr/share/keyrings/doppler-archive-keyring.gpg
  echo "deb [signed-by=/usr/share/keyrings/doppler-archive-keyring.gpg] https://packages.doppler.com/public/cli/deb/debian any-version main" \
    > /etc/apt/sources.list.d/doppler-cli.list
  apt-get update
  apt-get install -y doppler
fi

echo "==> Deploy user (SSH key login, may run docker)"
if ! id "${DEPLOY_USER}" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" "${DEPLOY_USER}"
fi
usermod -aG docker "${DEPLOY_USER}"
if [[ -s /root/.ssh/authorized_keys && ! -s /home/${DEPLOY_USER}/.ssh/authorized_keys ]]; then
  install -d -m 700 -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" /home/${DEPLOY_USER}/.ssh
  install -m 600 -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" /root/.ssh/authorized_keys /home/${DEPLOY_USER}/.ssh/authorized_keys
fi

echo "==> SSH: keys only, once a key is installed"
if [[ -s /root/.ssh/authorized_keys ]]; then
  cat > /etc/ssh/sshd_config.d/10-yayatoh.conf <<'CONF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
CONF
  systemctl reload ssh
else
  echo "    No SSH key in /root/.ssh/authorized_keys: password login stays ON. Add a key, then run this again." >&2
fi

echo "==> Code checkout and config folders"
install -d -m 0755 /opt/yayatoh
if [[ ! -d "${SRC}/.git" ]]; then
  git clone --depth 50 "${REPO_URL}" "${SRC}"
fi
install -d -m 0700 /etc/yayatoh
[[ -f /etc/yayatoh/deploy.env ]] || install -m 0600 "${SRC}/deploy/deploy.env.example" /etc/yayatoh/deploy.env

echo "==> Backup timers (pgBackRest: weekly full, daily differential, daily check)"
install -m 0644 "${SRC}"/deploy/systemd/*.service "${SRC}"/deploy/systemd/*.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable yayatoh-backup-full.timer yayatoh-backup-diff.timer yayatoh-backup-check.timer

cat <<'NEXT'

Server prepared. Next (docs/runbooks/deploy-contabo.md):
  1. Put the Doppler service token in /etc/yayatoh/doppler.token  (chmod 600)
  2. Edit /etc/yayatoh/deploy.env (ACME_EMAIL, memory settings)
  3. Point DNS at this server, then run: bash /opt/yayatoh/src/deploy/scripts/first-run.sh <commit>
NEXT
