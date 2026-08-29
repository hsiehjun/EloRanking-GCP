#!/bin/bash
PROJECT_ID="eloranking-506820"
REGION="us-central1"
SERVICE_NAME="elo-ranking"
CLOUDSQL_INSTANCE="${PROJECT_ID}:${REGION}:elo-ranking-db"
DB_PASS='Jung@1475369'

echo "--> Granting Cloud Build permissions to deploy to Cloud Run..."
PROJECT_NUM=$(gcloud projects describe ${PROJECT_ID} --format="value(projectNumber)")
gcloud projects add-iam-policy-binding ${PROJECT_ID} \
  --member="serviceAccount:${PROJECT_NUM}@cloudbuild.gserviceaccount.com" \
  --role="roles/run.admin" --condition=None

gcloud projects add-iam-policy-binding ${PROJECT_ID} \
  --member="serviceAccount:${PROJECT_NUM}@cloudbuild.gserviceaccount.com" \
  --role="roles/iam.serviceAccountUser" --condition=None

echo "--> Updating Cloud Run with attached Cloud SQL and password..."
gcloud run services update ${SERVICE_NAME} \
  --region=${REGION} \
  --set-cloudsql-instances=${CLOUDSQL_INSTANCE} \
  --set-env-vars="DATABASE_URL=dbname=elo_ranking user=elo_user password=${DB_PASS} host=/cloudsql/${CLOUDSQL_INSTANCE},CRON_SECRET_KEY=wh40k-elo-secret-cron-key"

echo "--> Testing Health Endpoint..."
curl -s "https://elo-ranking-n6cmw52ska-uc.a.run.app/api/stats" || true
