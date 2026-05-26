#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT_DIR="$ROOT_DIR/output"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/canal-plus-build.XXXXXX")"

cleanup() {
  rm -rf "$TMP_DIR"
}

trap cleanup EXIT

FRONTEND_STAGE_DIR="$TMP_DIR/canal-plus-frontend"
BACKEND_STAGE_DIR="$TMP_DIR/canal-plus-backend"
FRONTEND_ARCHIVE="$OUTPUT_DIR/canal-plus-frontend.tar.gz"
BACKEND_ARCHIVE="$OUTPUT_DIR/canal-plus-backend.tar.gz"
BACKEND_BINARY_NAME="canal-plus-backend"

echo "==> Building frontend"
npm run build -w frontend --prefix "$ROOT_DIR"

echo "==> Building backend"
(
  cd "$ROOT_DIR/backend"
  go build -o "bin/$BACKEND_BINARY_NAME" ./cmd/server
)

echo "==> Preparing output directory"
mkdir -p "$OUTPUT_DIR"
rm -f "$FRONTEND_ARCHIVE" "$BACKEND_ARCHIVE"

echo "==> Packaging frontend"
mkdir -p "$FRONTEND_STAGE_DIR"
cp -R "$ROOT_DIR/frontend/dist/." "$FRONTEND_STAGE_DIR/"
cat > "$FRONTEND_STAGE_DIR/README.txt" <<'EOF'
Canal Plus frontend package

- Static build output is in this directory.
- Deploy these files to any static web server, or place them behind Nginx.
- If you need a local preview, serve this directory as static files.
EOF
tar -C "$TMP_DIR" -czf "$FRONTEND_ARCHIVE" "$(basename "$FRONTEND_STAGE_DIR")"

echo "==> Packaging backend"
mkdir -p "$BACKEND_STAGE_DIR/bin"
cp "$ROOT_DIR/backend/bin/$BACKEND_BINARY_NAME" "$BACKEND_STAGE_DIR/bin/$BACKEND_BINARY_NAME"
cp "$ROOT_DIR/backend/.env.example" "$BACKEND_STAGE_DIR/.env.example"
cat > "$BACKEND_STAGE_DIR/start.sh" <<'EOF'
#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

exec ./bin/canal-plus-backend
EOF
chmod +x "$BACKEND_STAGE_DIR/start.sh"
cat > "$BACKEND_STAGE_DIR/README.txt" <<'EOF'
Canal Plus backend package

- Copy .env.example to .env and set CANAL_PLUS_METADATA_DSN before startup.
- Run ./start.sh to start the backend service.
- The backend stores metadata and runtime state in the configured MySQL RDB.
EOF
tar -C "$TMP_DIR" -czf "$BACKEND_ARCHIVE" "$(basename "$BACKEND_STAGE_DIR")"

echo "==> Build artifacts created"
echo "Frontend: $FRONTEND_ARCHIVE"
echo "Backend:  $BACKEND_ARCHIVE"
