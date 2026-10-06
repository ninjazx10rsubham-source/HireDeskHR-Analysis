# Contabo VPS & Hostinger Domain Deployment Guide
### Production Deployment for Software Workforce - TalentFlow ATS

This guide walks you step-by-step through deploying the **TalentFlow ATS** platform onto a **Contabo Cloud VPS** (Ubuntu 22.04 / 24.04 LTS) connected to a **Hostinger custom domain** and **Hostinger Business Email** with full automated resume ingestion and Email + WhatsApp OTP authentication.

---

## Architecture Overview

```
[Candidate / Recruiter]
         │
         ▼
[Hostinger Domain DNS] ──(A Record: @ / www)──► [Contabo VPS IP (e.g. 194.163.140.85)]
         │                                                      │
         ├─(MX Records)─► Hostinger Business Email              │
         │                (mail.hostinger.com)                  ▼
         │                         │                    [Nginx Reverse Proxy]
         │                         ▼                     (Port 80/443 SSL)
         │               Inbound Resume Forwarder               │
         │                         │                            ├─► Static Frontend (/dist)
         │                         ▼                            └─► Backend API (Port 5001)
         └──────────► [POST /api/automation/inbound-email] ─────┘
                                   │
                                   ▼
                   [Automatic Resume Extraction & Matching]
                    Ingested into ATS Job under "Applied"
```

---

## Step 1: Contabo VPS Initial Server Setup

1. **Connect to your Contabo VPS via SSH**:
   ```bash
   ssh root@<YOUR_CONTABO_VPS_IP>
   ```

2. **Update system packages**:
   ```bash
   apt update && apt upgrade -y
   ```

3. **Install essential utilities**:
   ```bash
   apt install -y curl wget git ufw certbot python3-certbot-nginx build-essential
   ```

4. **Install Node.js 20 LTS & PM2**:
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
   apt install -y nodejs
   npm install -g pm2
   ```

5. **Configure Firewall (UFW)**:
   ```bash
   ufw allow OpenSSH
   ufw allow 'Nginx Full'
   ufw --force enable
   ```

---

## Step 2: Hostinger Domain & DNS Configuration

In your **Hostinger Control Panel (hPanel)** &rarr; **Domains** &rarr; **DNS / Nameservers**:

### 1. Point Domain to Contabo VPS (Web Traffic)
Add or update the following DNS records:

| Type | Name | Content / Value | TTL | Purpose |
|------|------|-----------------|-----|---------|
| **A** | `@` | `<YOUR_CONTABO_VPS_IP>` | 300 | Root domain (e.g. yourdomain.com) |
| **A** | `www` | `<YOUR_CONTABO_VPS_IP>` | 300 | WWW subdomain |

### 2. Configure Hostinger Business Email (MX & Security Records)
To keep Hostinger Webmail (`mail.hostinger.com`) active alongside your Contabo website:

| Type | Name | Priority | Content / Value | Purpose |
|------|------|----------|-----------------|---------|
| **MX** | `@` | 5 | `mx1.hostinger.com` | Primary Hostinger Mail Server |
| **MX** | `@` | 10 | `mx2.hostinger.com` | Secondary Hostinger Mail Server |
| **TXT** | `@` | - | `v=spf1 include:_spf.mail.hostinger.com ~all` | SPF Email Authentication |
| **TXT** | `_dmarc` | - | `v=DMARC1; p=quarantine;` | DMARC Email Protection |

---

## Step 3: Clone Codebase & Build Application

1. **Clone the repository**:
   ```bash
   mkdir -p /var/www
   cd /var/www
   git clone https://github.com/Shravanihn20/Full-Stack-project.git talentflow-ats
   cd talentflow-ats
   ```

2. **Install and build Backend**:
   ```bash
   cd /var/www/talentflow-ats/backend
   npm install
   npm run build
   ```

3. **Install and build Frontend**:
   ```bash
   cd /var/www/talentflow-ats/frontend
   npm install
   npm run build
   ```

---

## Step 4: Configure Process Manager (PM2)

1. Create application log directory:
   ```bash
   mkdir -p /var/log/talentflow
   ```

2. Copy the production PM2 ecosystem config:
   ```bash
   cp /var/www/talentflow-ats/deployment/ecosystem.config.js /var/www/talentflow-ats/ecosystem.config.js
   ```

3. Start backend service:
   ```bash
   cd /var/www/talentflow-ats
   pm2 start ecosystem.config.js
   pm2 save
   pm2 startup
   ```
   *(Run the command output by `pm2 startup` to enable autostart on reboot)*.

---

## Step 5: Configure Nginx & Let's Encrypt SSL

1. **Copy Nginx configuration**:
   ```bash
   cp /var/www/talentflow-ats/deployment/nginx.conf /etc/nginx/sites-available/talentflow
   ```

2. **Update your domain name in `/etc/nginx/sites-available/talentflow`**:
   Replace `yourdomain.com` with your actual domain (e.g. `softwareworkforce.com`).

3. **Enable site**:
   ```bash
   ln -s /etc/nginx/sites-available/talentflow /etc/nginx/sites-enabled/
   rm -f /etc/nginx/sites-enabled/default
   nginx -t
   systemctl reload nginx
   ```

4. **Issue Free SSL Certificate (Let's Encrypt)**:
   ```bash
   certbot --nginx -d yourdomain.com -d www.yourdomain.com
   ```
   Certbot will automatically configure HTTPS renewal.

---

## Step 6: Hostinger Inbound Resume Email Automation

In Hostinger Webmail (`mail.hostinger.com`) or hPanel **Email Accounts** &rarr; **Email Forwarders / Filters**:

1. **Create Forwarding Rule or Webhook**:
   - Forward emails with attachments from `recruiter@yourdomain.com` or `jobs@yourdomain.com` to:
     `https://yourdomain.com/api/automation/inbound-email`
2. **Automated ATS Action**:
   - When an email arrives with subject `"New candidate applied to [Job Title] role"` and attached PDF resume (like in your Hostinger Webmail screenshot):
     - The ATS parses the applicant name and email.
     - Saves the resume in the candidate file storage.
     - Creates the candidate profile in the ATS database under the matching Job in the **"Applied"** stage.
     - Dispatches a confirmation receipt.

---

## Step 7: Dual-Channel OTP (Email + WhatsApp)

1. **Email OTP**: Dispatched via Hostinger SMTP (`smtp.hostinger.com:465`) or SendGrid.
2. **WhatsApp OTP**: Dispatched via WhatsApp Cloud API / Twilio WhatsApp Sandbox.
3. In-app visualizer provides immediate OTP auto-fill and direct WhatsApp Web link button for rapid client verification.

---

## Useful Maintenance Commands

| Task | Command |
|------|---------|
| Check Backend Status | `pm2 status` |
| View Backend Logs | `pm2 logs talentflow-backend` |
| Restart Application | `pm2 restart talentflow-backend` |
| Reload Nginx | `nginx -t && systemctl reload nginx` |
| Test Inbound Automation | `curl -X POST https://yourdomain.com/api/automation/simulate-hostinger-email` |
