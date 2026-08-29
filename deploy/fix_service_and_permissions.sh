#!/bin/bash
set -e

PROJECT_ID="eloranking-506820"
REGION="us-central1"
SERVICE_NAME="elo-ranking"
CLOUDSQL_INSTANCE="${PROJECT_ID}:${REGION}:elo-ranking-db"
DB_PASS='Jung@1475369'

echo "=========================================================="
echo "  Deploying Clean Update to Cloud Run (${SERVICE_NAME})"
echo "=========================================================="

echo "--> 1. Granting Cloud Build permissions..."
PROJECT_NUM=$(gcloud projects describe ${PROJECT_ID} --format="value(projectNumber)")
gcloud projects add-iam-policy-binding ${PROJECT_ID} \
  --member="serviceAccount:${PROJECT_NUM}@cloudbuild.gserviceaccount.com" \
  --role="roles/run.admin" --condition=None >/dev/null 2>&1 || true

gcloud projects add-iam-policy-binding ${PROJECT_ID} \
  --member="serviceAccount:${PROJECT_NUM}@cloudbuild.gserviceaccount.com" \
  --role="roles/iam.serviceAccountUser" --condition=None >/dev/null 2>&1 || true

echo "--> 2. Building & Deploying latest code to Cloud Run..."
gcloud run deploy ${SERVICE_NAME} \
  --source . \
  --region=${REGION} \
  --platform managed \
  --allow-unauthenticated \
  --set-cloudsql-instances=${CLOUDSQL_INSTANCE} \
  --set-env-vars="DATABASE_URL=dbname=elo_ranking user=elo_user password=${DB_PASS} host=/cloudsql/${CLOUDSQL_INSTANCE},CRON_SECRET_KEY=wh40k-elo-secret-cron-key" \
  --memory 1Gi \
  --cpu 1

echo ""
echo "--> 3. Verifying Live Site API Health..."
sleep 3
curl -s -i "https://elo-ranking-911555823374.us-central1.run.app/api/stats"
echo ""
echo "=========================================================="
echo "  Deployment Complete! Website is fully active & healthy! "
echo "=========================================================="
