#!/bin/bash
# ==============================================================================
# ONE-CLICK GOOGLE CLOUD PROVISIONING & DEPLOYMENT SCRIPT
# ==============================================================================
set -e

PROJECT_ID=$(gcloud config get-value project 2>/dev/null)
if [ -z "$PROJECT_ID" ]; then
    echo "ERROR: No GCP project configured in gcloud CLI."
    echo "Run: gcloud config set project YOUR_PROJECT_ID"
    exit 1
fi

REGION="${GCP_REGION:-us-central1}"
INSTANCE_NAME="${DB_INSTANCE:-elo-ranking-db}"
DB_NAME="elo_ranking"
DB_USER="elo_user"
DB_PASS="${DB_PASSWORD:-EloSecurePass2026!}"
SERVICE_NAME="elo-ranking"
REPO_NAME="elo-ranking"
IMAGE_TAG="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO_NAME}/${SERVICE_NAME}:latest"
CRON_SECRET="${CRON_SECRET_KEY:-wh40k-elo-secret-cron-key}"

echo "=========================================================="
echo "  Deploying Warhammer 40k Elo Platform to Google Cloud    "
echo "  GCP Project:      ${PROJECT_ID}"
echo "  Compute Region:   ${REGION}"
echo "  Cloud Run Target: ${SERVICE_NAME}"
echo "=========================================================="

# 1. Enable Required GCP APIs
echo "--> Enabling GCP APIs..."
gcloud services enable \
    run.googleapis.com \
    sqladmin.googleapis.com \
    cloudscheduler.googleapis.com \
    artifactregistry.googleapis.com \
    cloudbuild.googleapis.com

# 2. Setup Artifact Registry Docker Repository
echo "--> Verifying Artifact Registry repository..."
gcloud artifacts repositories describe ${REPO_NAME} --location=${REGION} >/dev/null 2>&1 || \
    gcloud artifacts repositories create ${REPO_NAME} \
        --repository-format=docker \
        --location=${REGION} \
        --description="Docker repository for Elo Ranking"

# 3. Setup Cloud SQL PostgreSQL Instance
echo "--> Verifying Cloud SQL instance ${INSTANCE_NAME}..."
if ! gcloud sql instances describe ${INSTANCE_NAME} >/dev/null 2>&1; then
    echo "Creating Cloud SQL PostgreSQL instance ${INSTANCE_NAME} (~3-5 mins)..."
    gcloud sql instances create ${INSTANCE_NAME} \
        --database-version=POSTGRES_15 \
        --tier=db-f1-micro \
        --region=${REGION} \
        --storage-size=10 \
        --storage-auto-increase \
        --backup-start-time=04:00
fi

# Ensure database and user exist
gcloud sql databases create ${DB_NAME} --instance=${INSTANCE_NAME} >/dev/null 2>&1 || true
gcloud sql users create ${DB_USER} --instance=${INSTANCE_NAME} --password=${DB_PASS} >/dev/null 2>&1 || true

INSTANCE_CONNECTION_NAME=$(gcloud sql instances describe ${INSTANCE_NAME} --format="value(connectionName)")
echo "--> Cloud SQL Connection Name: ${INSTANCE_CONNECTION_NAME}"

# 4. Build and Push Container Image
echo "--> Building Docker image via Cloud Build..."
gcloud builds submit --tag ${IMAGE_TAG} .

# 5. Deploy Cloud Run Service
echo "--> Deploying Cloud Run service..."
DATABASE_URL="postgresql://${DB_USER}:${DB_PASS}@/${DB_NAME}?host=/cloudsql/${INSTANCE_CONNECTION_NAME}"

gcloud run deploy ${SERVICE_NAME} \
    --image ${IMAGE_TAG} \
    --region ${REGION} \
    --platform managed \
    --allow-unauthenticated \
    --add-cloudsql-instances ${INSTANCE_CONNECTION_NAME} \
    --set-env-vars "DATABASE_URL=${DATABASE_URL},CRON_SECRET_KEY=${CRON_SECRET}" \
    --memory 1Gi \
    --cpu 1 \
    --min-instances 0 \
    --max-instances 10 \
    --concurrency 80 \
    --timeout 300

SERVICE_URL=$(gcloud run services describe ${SERVICE_NAME} --region=${REGION} --format="value(status.url)")

# 6. Setup Cloud Scheduler Job (Runs every 6 hours)
echo "--> Configuring Cloud Scheduler for automated tournament scraping..."
gcloud scheduler jobs delete elo-scraper-job --location=${REGION} --quiet >/dev/null 2>&1 || true

gcloud scheduler jobs create http elo-scraper-job \
    --location=${REGION} \
    --schedule="0 */6 * * *" \
    --uri="${SERVICE_URL}/api/cron/sync-tournaments" \
    --http-method=POST \
    --headers="X-Cron-Key=${CRON_SECRET}" \
    --description="Scrapes new BCP tournaments and recalculates Elo every 6 hours"

echo ""
echo "=========================================================="
echo "  DEPLOYMENT SUCCESSFUL!                                  "
echo "  Cloud Run URL: ${SERVICE_URL}                           "
echo "=========================================================="
