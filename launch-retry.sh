#!/usr/bin/env bash
# Keeps trying to launch the shino-tts VM on Oracle Cloud's Always Free Arm shape until there's
# capacity. Each round tries 2 OCPUs / 12 GB first, then 1 OCPU / 6 GB, then waits 10 minutes.
# It stops when an instance launches, or on any error other than "out of capacity" or rate limiting.
#
# Uses the same settings as the console form: Ubuntu 24.04 (aarch64), the public subnet of
# shino-vcn, a public IPv4 address, IMDSv2 only, restore-after-maintenance, the default boot volume.
#
# Needs the OCI CLI, set up with `oci setup config` (see README-voice.md), and your SSH public key:
#   ./launch-retry.sh ~/.ssh/shino-tts.key.pub
# Keep the computer awake while it runs (macOS: caffeinate -i ./launch-retry.sh ...).
set -euo pipefail

PUBKEY=${1:?usage: ./launch-retry.sh <ssh-public-key-file>}
PROFILE=${OCI_CLI_PROFILE:-DEFAULT}
CONFIG=${OCI_CLI_CONFIG_FILE:-$HOME/.oci/config}
NAME=shino-tts
SHAPE=VM.Standard.A1.Flex
SUBNET_NAME="public subnet-shino-vcn"
INTERVAL=${INTERVAL:-600} # seconds between rounds
SIZES=("2 12" "1 6")      # OCPUs and GB, best first

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
die() { log "$*"; exit 1; }
oci_q() { oci --profile "$PROFILE" "$@"; }

command -v oci >/dev/null || die "The OCI CLI isn't installed (see README-voice.md)."
[ -f "$PUBKEY" ] || die "No such file: $PUBKEY"
grep -qE '^(ssh-(rsa|ed25519)|ecdsa-)' "$PUBKEY" ||
  die "$PUBKEY doesn't look like an SSH public key. Make one from the private key: ssh-keygen -y -f <private-key> > <private-key>.pub"

# The root compartment is the tenancy itself; read its OCID from the CLI config.
TENANCY=${COMPARTMENT:-$(awk -v p="[$PROFILE]" '
  $0 == p { f = 1; next }
  /^\[/ { f = 0 }
  f && /^tenancy[ \t]*=/ { sub(/^tenancy[ \t]*=[ \t]*/, ""); print; exit }' "$CONFIG")}
[ -n "$TENANCY" ] || die "No tenancy in $CONFIG for profile $PROFILE. Run: oci setup config"

empty() { [ -z "$1" ] || [ "$1" = "null" ]; }

AD=$(oci_q iam availability-domain list --compartment-id "$TENANCY" --query 'data[0].name' --raw-output)
empty "$AD" && die "Couldn't read the availability domain."

SUBNET=$(oci_q network subnet list --compartment-id "$TENANCY" --display-name "$SUBNET_NAME" \
  --query 'data[0].id' --raw-output)
empty "$SUBNET" && die "No subnet named \"$SUBNET_NAME\" in the root compartment."

# The newest Ubuntu 24.04 build for this shape (the aarch64 one), excluding Minimal.
IMAGE=$(oci_q compute image list --compartment-id "$TENANCY" --operating-system "Canonical Ubuntu" \
  --operating-system-version "24.04" --shape "$SHAPE" --sort-by TIMECREATED --sort-order DESC --all \
  --query "data[?!(contains(\"display-name\", 'Minimal'))] | [0].id" \
  --raw-output)
empty "$IMAGE" && die "Couldn't find an Ubuntu 24.04 image for $SHAPE."
IMAGE_NAME=$(oci_q compute image get --image-id "$IMAGE" --query 'data."display-name"' --raw-output)

log "Availability domain: $AD"
log "Subnet:              $SUBNET_NAME"
log "Image:               $IMAGE_NAME"
log "Trying every $((INTERVAL / 60)) minutes. Stop with Ctrl+C."

attempt=0
while true; do
  # Never create a second one: a running instance plus a new one would exceed the free limit.
  existing=$(oci_q compute instance list --compartment-id "$TENANCY" --display-name "$NAME" \
    --query "length(data[?\"lifecycle-state\" != 'TERMINATED' && \"lifecycle-state\" != 'TERMINATING'])" \
    --raw-output)
  if [ "${existing:-0}" != "0" ]; then
    log "An instance named $NAME already exists. Nothing to do."
    exit 0
  fi

  for size in "${SIZES[@]}"; do
    read -r ocpus mem <<<"$size"
    attempt=$((attempt + 1))
    if out=$(oci_q compute instance launch \
      --compartment-id "$TENANCY" \
      --availability-domain "$AD" \
      --display-name "$NAME" \
      --shape "$SHAPE" \
      --shape-config "{\"ocpus\": $ocpus, \"memoryInGBs\": $mem}" \
      --image-id "$IMAGE" \
      --subnet-id "$SUBNET" \
      --assign-public-ip true \
      --ssh-authorized-keys-file "$PUBKEY" \
      --instance-options '{"areLegacyImdsEndpointsDisabled": true}' \
      --availability-config '{"recoveryAction": "RESTORE_INSTANCE"}' \
      --query 'data.id' --raw-output 2>&1); then
      log "Launched $NAME with $ocpus OCPU(s) / $mem GB: $out"
      log "It takes a minute or two to start. Find its public IP in the console (Compute > Instances)."
      printf '\a'
      command -v osascript >/dev/null && osascript -e "display notification \"$NAME launched ($ocpus OCPU)\" with title \"Oracle Cloud\"" || true
      exit 0
    fi

    if grep -qiE 'out of (host )?capacity' <<<"$out"; then
      log "Attempt $attempt: no capacity for $ocpus OCPU(s) / $mem GB."
    elif grep -qiE 'TooManyRequests|429' <<<"$out"; then
      log "Attempt $attempt: rate limited; waiting longer."
      sleep $((INTERVAL * 2))
    else
      log "Attempt $attempt failed with an unexpected error. Stopping:"
      echo "$out"
      exit 1
    fi
  done
  sleep "$INTERVAL"
done
