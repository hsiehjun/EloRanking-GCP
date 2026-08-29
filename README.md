# 🚀 Warhammer 40k Elo Platform: GCP Serverless Deployment

This repository is configured for serverless production deployment on **Google Cloud Platform (GCP)** using:
* **Cloud Run**: Auto-scaling serverless web containers running FastAPI & Gunicorn.
* **Cloud SQL for PostgreSQL**: High-performance managed database.
* **Cloud Scheduler**: Automated 6-hour cron worker for scraping new BCP tournaments & calculating Elo deltas.
* **Artifact Registry & Cloud Build**: Continuous deployment pipeline.

---

## ⚡ Quick Start: Deploy to GCP in 3 Steps

### **Step 1: Set your GCP Project**
```bash
gcloud config set project YOUR_GCP_PROJECT_ID
```

### **Step 2: Migrate Your PostgreSQL Database from the VM**
Run this script on your VM to dump the existing 481,000 matches and restore them into Cloud SQL:
```bash
chmod +x deploy/migrate_db_from_vm.sh
./deploy/migrate_db_from_vm.sh
```

### **Step 3: Deploy to Cloud Run & Cloud Scheduler**
```bash
chmod +x deploy/deploy.sh
./deploy/deploy.sh
```

---

## 🔄 Deploying Future Git Changes

Whenever you make updates to the code:
1. **Via Cloud Build (Instant)**:
   ```bash
   gcloud builds submit --config cloudbuild.yaml .
   ```
2. **Via GitHub Actions**:
   Push to your `main` branch on GitHub, and the workflow in `.github/workflows/deploy.yml` will automatically build and update Cloud Run with zero downtime!

---

## 🌐 Custom Domain Setup (wh40k-elo.duckdns.org)

1. Run:
   ```bash
   gcloud beta run domain-mappings create \
     --service elo-ranking \
     --domain wh40k-elo.duckdns.org \
     --region us-central1
   ```
2. Point your DuckDNS IP / CNAME record to the DNS records shown in the terminal output. Google Cloud handles SSL certificate provisioning automatically!
