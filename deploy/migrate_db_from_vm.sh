#!/bin/bash
# ==============================================================================
# DATABASE MIGRATION SCRIPT: VM PostgreSQL -> GCP Cloud SQL
# ==============================================================================
set -e

PROJECT_ID=$(gcloud config get-value project 2>/dev/null)
INSTANCE_NAME="${DB_INSTANCE:-elo-ranking-db}"
DB_NAME="elo_ranking"
DB_USER="elo_user"
BUCKET_NAME="${PROJECT_ID}-elo-migration-backup"
DUMP_FILE="elo_ranking_backup_$(date +%Y%m%d_%H%M%S).sql"

echo "=========================================================="
echo "  Migrating PostgreSQL Data from VM to GCP Cloud SQL     "
echo "=========================================================="

# 1. Create a Cloud Storage bucket for the migration file
echo "--> Setting up Cloud Storage staging bucket..."
gsutil ls -b gs://${BUCKET_NAME} >/dev/null 2>&1 || gsutil mb -p ${PROJECT_ID} -l us-central1 gs://${BUCKET_NAME}

# Grant Cloud SQL Service Account permission to read from bucket
SQL_SA=$(gcloud sql instances describe ${INSTANCE_NAME} --format="value(serviceAccountEmailAddress)")
echo "Granting storage.objectAdmin to Cloud SQL service account: ${SQL_SA}..."
gsutil iam ch serviceAccount:${SQL_SA}:objectAdmin gs://${BUCKET_NAME}

# 2. Dump Local PostgreSQL Database on the VM
echo "--> Exporting local PostgreSQL database..."
sudo -u postgres pg_dump --clean --if-exists --no-owner --no-privileges -d elo_ranking > /tmp/${DUMP_FILE}

# 3. Upload to Google Cloud Storage
echo "--> Uploading backup to gs://${BUCKET_NAME}/${DUMP_FILE}..."
gsutil cp /tmp/${DUMP_FILE} gs://${BUCKET_NAME}/${DUMP_FILE}
rm -f /tmp/${DUMP_FILE}

# 4. Import Dump into Cloud SQL Instance
echo "--> Importing SQL dump into Cloud SQL instance ${INSTANCE_NAME}..."
gcloud sql import sql ${INSTANCE_NAME} gs://${BUCKET_NAME}/${DUMP_FILE} \
    --database=${DB_NAME} \
    --user=${DB_USER} \
    --quiet

echo "=========================================================="
echo "  DATABASE MIGRATION COMPLETE!                            "
echo "  All tournaments, matches, and users are in Cloud SQL.   "
echo "=========================================================="
