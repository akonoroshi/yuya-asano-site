#!/bin/sh
set -eu

: "${VRM_CHARACTERS_DEPLOY_KEY:?Set the base64-encoded, read-only VRM deploy key as a build secret.}"
umask 077
key_dir=$(mktemp -d)
trap 'rm -rf "$key_dir"' EXIT
printf '%s' "$VRM_CHARACTERS_DEPLOY_KEY" | base64 -d > "$key_dir/key"
unset VRM_CHARACTERS_DEPLOY_KEY

# Use GitHub's published Ed25519 host key, including for SSH on port 443.
printf '%s\n' '[ssh.github.com]:443 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl' > "$key_dir/known_hosts"
export GIT_SSH_COMMAND="ssh -F /dev/null -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o HostName=ssh.github.com -p 443 -i '$key_dir/key' -o UserKnownHostsFile='$key_dir/known_hosts'"

sh scripts/update-character-dependency.sh "$key_dir"
npm ci
