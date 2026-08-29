#!/bin/bash
# ==============================================================================
# ONE-CLICK GCP CLOUD RUN + CLOUD SQL + CLOUD SCHEDULER DEPLOYMENT SCRIPT
# ==============================================================================
set -e

# Configuration (Customize as needed)
PROJECT_ID=$(gcloud config get-value project)
REGION="${GCP_REGION:-us-central1}"
INSTANCE_NAME="${DB_INSTANCE:-elo-ranking-db}"
DB_NAME="elo_ranking"
DB_USER="elo_user"
DB_PASS="${DB_PASSWORD:-EloSecurePass2026!}"
SERVICE_NAME="elo-ranking"
REPO_NAME="elo-ranking"
IMAGE_TAG="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO_NAME}/${SERVICE_NAME}:latest"
CRON_SECRET="${CRON_SECRET_KEY:-wh40k-elo-secret-cron-key}"

echo "========================================================"
echo "  Deploying Warhammer 40k Elo Ranking to Google Cloud  "
echo "  Project:  ${PROJECT_ID}"
echo "  Region:   ${REGION}"
echo "  Service:  ${SERVICE_NAME}"
echo "========================================================"

# 1. Enable Required GCP APIs
echo "--> Enabling GCP APIs..."
gcloud services enable     run.googleapis.com     sqladmin.googleapis.com     cloudscheduler.googleapis.com     artifactregistry.googleapis.com     cloudbuild.googleapis.com

# 2. Create Artifact Registry Docker repository if not exists
echo "--> Setting up Artifact Registry..."
gcloud artifacts repositories describe ${REPO_NAME} --location=${REGION} >/dev/null 2>&1 ||     gcloud artifacts repositories create ${REPO_NAME}         --repository-format=docker         --location=${REGION}         --description="Docker repository for Elo Ranking"

# 3. Create Cloud SQL PostgreSQL instance if not exists
echo "--> Setting up Cloud SQL PostgreSQL instance..."
if ! gcloud sql instances describe ${INSTANCE_NAME} >/dev/null 2>&1; then
    echo "Creating Cloud SQL instance ${INSTANCE_NAME} (this takes ~3-5 mins)..."
    gcloud sql instances create ${INSTANCE_NAME}         --database-version=POSTGRES_15         --tier=db-custom-2-7680         --region=${REGION}         --storage-size=20         --storage-auto-increase         --backup-start-time=04:00
fi

# Create Database and User
gcloud sql databases create ${DB_NAME} --instance=${INSTANCE_NAME} >/dev/null 2>&1 || true
gcloud sql users create ${DB_USER} --instance=${INSTANCE_NAME} --password=${DB_PASS} >/dev/null 2>&1 || true

# Get Cloud SQL Connection Name
INSTANCE_CONNECTION_NAME=$(gcloud sql instances describe ${INSTANCE_NAME} --format="value(connectionName)")
echo "Cloud SQL Connection Name: ${INSTANCE_CONNECTION_NAME}"

# 4. Build and Push Container Image
echo "--> Building Docker image via Cloud Build..."
gcloud builds submit --tag ${IMAGE_TAG} .

# 5. Deploy Cloud Run Service
echo "--> Deploying to Cloud Run..."
DATABASE_URL="postgresql://${DB_USER}:${DB_PASS}@/${DB_NAME}?host=/cloudsql/${INSTANCE_CONNECTION_NAME}"

gcloud run deploy ${SERVICE_NAME}     --image ${IMAGE_TAG}     --region ${REGION}     --platform managed     --allow-unauthenticated     --add-cloudsql-instances ${INSTANCE_CONNECTION_NAME}     --set-env-vars "DATABASE_URL=${DATABASE_URL},CRON_SECRET_KEY=${CRON_SECRET}"     --memory 2Gi     --cpu 2     --min-instances 0     --max-instances 10     --concurrency 80     --timeout 300

SERVICE_URL=$(gcloud run services describe ${SERVICE_NAME} --region=${REGION} --format="value(status.url)")
echo "--> Service successfully deployed at: ${SERVICE_URL}"

# 6. Setup Cloud Scheduler (Runs every 6 hours)
echo "--> Setting up Cloud Scheduler for automatic tournament sync..."
gcloud scheduler jobs delete elo-scraper-job --location=${REGION} --quiet >/dev/null 2>&1 || true

gcloud scheduler jobs create http elo-scraper-job     --location=${REGION}     --schedule="0 */6 * * *"     --uri="${SERVICE_URL}/api/cron/sync-tournaments"     --http-method=POST     --headers="X-Cron-Key=${CRON_SECRET}"     --description="Scrapes newly concluded BCP tournaments and recalculates Elo every 6 hours"

echo "========================================================"
echo "  DEPLOYMENT COMPLETE!                                  "
echo "  URL: ${SERVICE_URL}                                   "
echo "========================================================"
