#!/usr/bin/env bash
# NLO Leads — puts the website-request receiver online (Google Cloud Run, Node.js 24, no dependencies).
# Run once in Google Cloud Shell, signed in with the Google account that owns the nlo-cases Firebase project:
#   git clone --depth 1 https://github.com/amooloo/nlo-apps && bash nlo-apps/nlo-leads-src/intake/deploy-intake.sh
# Running it again updates the service in place. Nothing here reads or changes the app's data.
set -euo pipefail
PROJECT="${PROJECT:-nlo-cases}"
REGION="${REGION:-us-central1}"
SERVICE=lead-intake
SA_NAME=lead-intake
SA="${SA_NAME}@${PROJECT}.iam.gserviceaccount.com"
BUILD_NAME=lead-intake-build
BUILD_SA="${BUILD_NAME}@${PROJECT}.iam.gserviceaccount.com"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "== NLO Leads: website request receiver → project ${PROJECT} =="
gcloud config set project "$PROJECT" >/dev/null
if [ "$(gcloud billing projects describe "$PROJECT" --format='value(billingEnabled)' 2>/dev/null || true)" = "False" ]; then
  echo "This project has no billing account (Blaze plan) linked. Link one in the Firebase console, then run this again."; exit 1
fi

echo "-- 1/5 turning on the Google services it uses (the first time takes a minute)"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  storage.googleapis.com iam.googleapis.com firestore.googleapis.com logging.googleapis.com --quiet

echo "-- 2/5 two accounts: one that runs the service (Firestore only), one that builds it"
grant() {  # a brand-new account can take a few seconds before it can be given a role
  for i in 1 2 3 4 5 6; do
    gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:$1" --role="$2" --condition=None --quiet >/dev/null 2>&1 && return 0
    sleep 10
  done
  echo "Couldn't give $1 the role $2. Run this script again in a minute."; exit 1
}
for acct in "${SA_NAME}:NLO Leads website intake" "${BUILD_NAME}:NLO Leads intake builder"; do
  gcloud iam service-accounts describe "${acct%%:*}@${PROJECT}.iam.gserviceaccount.com" >/dev/null 2>&1 || \
    gcloud iam service-accounts create "${acct%%:*}" --display-name="${acct#*:}" --quiet
done
grant "$SA" roles/datastore.user
grant "$BUILD_SA" roles/run.builder

echo "-- 3/5 building and deploying (3–5 minutes)"
RUN=(--source="$DIR" --region="$REGION" --allow-unauthenticated --service-account="$SA" --set-env-vars="GOOGLE_CLOUD_PROJECT=${PROJECT}"
     --cpu=1 --memory=256Mi --cpu-boost --concurrency=20 --max-instances=3 --timeout=30 --quiet)
if ! gcloud run deploy "$SERVICE" "${RUN[@]}" --build-service-account="projects/${PROJECT}/serviceAccounts/${BUILD_SA}"; then
  echo "   (trying again with Google's default build account)"
  NUM="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"
  gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:${NUM}-compute@developer.gserviceaccount.com" \
    --role="roles/run.builder" --condition=None --quiet >/dev/null 2>&1 || true
  gcloud run deploy "$SERVICE" "${RUN[@]}"
fi

echo "-- 4/5 keeping the private address out of the request logs"
# Cloud Run logs every request's full address, which here includes the secret (?k=…). Don't keep those lines.
FILTER='resource.type="cloud_run_revision" AND resource.labels.service_name="'"$SERVICE"'" AND logName:"run.googleapis.com%2Frequests"'
gcloud logging sinks update _Default --add-exclusion="name=nlo-lead-intake-requests,filter=${FILTER}" --quiet >/dev/null 2>&1 || \
  gcloud logging sinks update _Default --update-exclusion="name=nlo-lead-intake-requests,filter=${FILTER}" --quiet >/dev/null 2>&1 || \
  echo "   (couldn't add the log exclusion — not required, but you can add it under Logging → Log Router → _Default)"

echo "-- 5/5 done"
URL="$(gcloud run services describe "$SERVICE" --region="$REGION" --format='value(status.url)')"
echo
echo "The receiving service's address is:"
echo
echo "    ${URL}"
echo
echo "Paste it into NLO Leads → Settings → Website feed → step 1 and press Save."
