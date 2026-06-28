#!/usr/bin/env bash
# detect-stack.sh -- Detect project language, framework, package manager, and tooling
#
# Usage: ./detect-stack.sh [project-root]
#
# Outputs a structured summary of the detected stack. Run this from the project
# root or pass the project root as an argument.
#
# Exit codes:
#   0 -- Detection completed (even if stack is unknown)
#   1 -- Project root does not exist

set -euo pipefail

# ---- Configuration ----------------------------------------------------------

PROJECT_ROOT="${1:-.}"

if [[ ! -d "$PROJECT_ROOT" ]]; then
  echo "ERROR: Project root '$PROJECT_ROOT' does not exist" >&2
  exit 1
fi

cd "$PROJECT_ROOT"

# ---- Helpers ----------------------------------------------------------------

file_exists() { [[ -f "$1" ]]; }
dir_exists()  { [[ -d "$1" ]]; }

contains() {
  local file="$1"
  local pattern="$2"
  file_exists "$file" && grep -q "$pattern" "$file" 2>/dev/null
}

# ---- Detection --------------------------------------------------------------

LANGUAGE=""
LANGUAGE_VERSION=""
FRAMEWORK=""
PACKAGE_MANAGER=""
LOCKFILE=""
TEST_RUNNER=""
LINTER=""
HAS_DOCKER=false
HAS_DOCKER_COMPOSE=false
HAS_MAKEFILE=false
HAS_TASKFILE=false
BUILD_TOOL=""

# --- Node.js -----------------------------------------------------------------
if file_exists "package.json"; then
  LANGUAGE="node"

  # Detect package manager from lockfile
  if file_exists "pnpm-lock.yaml"; then
    PACKAGE_MANAGER="pnpm"
    LOCKFILE="pnpm-lock.yaml"
  elif file_exists "yarn.lock"; then
    PACKAGE_MANAGER="yarn"
    LOCKFILE="yarn.lock"
    # Detect Yarn version
    if file_exists ".yarnrc.yml"; then
      PACKAGE_MANAGER="yarn (berry)"
    fi
  elif file_exists "package-lock.json"; then
    PACKAGE_MANAGER="npm"
    LOCKFILE="package-lock.json"
  elif file_exists "bun.lockb"; then
    PACKAGE_MANAGER="bun"
    LOCKFILE="bun.lockb"
  else
    PACKAGE_MANAGER="npm (no lockfile)"
    LOCKFILE=""
  fi

  # Detect Node version
  if file_exists ".nvmrc"; then
    LANGUAGE_VERSION="$(cat .nvmrc | tr -d 'v\n')"
  elif file_exists ".node-version"; then
    LANGUAGE_VERSION="$(cat .node-version | tr -d 'v\n')"
  elif file_exists "package.json" && command -v jq >/dev/null 2>&1; then
    LANGUAGE_VERSION="$(jq -r '.engines.node // ""' package.json | tr -d '\n')"
  fi
  LANGUAGE_VERSION="${LANGUAGE_VERSION:-20 (assumed)}"

  # Detect TypeScript
  if file_exists "tsconfig.json"; then
    FRAMEWORK="typescript"
  fi

  # Detect test runner from package.json scripts or devDependencies
  if contains "package.json" '"vitest"'; then
    TEST_RUNNER="vitest"
  elif contains "package.json" '"jest"'; then
    TEST_RUNNER="jest"
  elif contains "package.json" '"mocha"'; then
    TEST_RUNNER="mocha"
  elif contains "package.json" '"node:test"'; then
    TEST_RUNNER="node:test"
  fi

  # Detect linter
  if file_exists "biome.json" || file_exists "biome.jsonc"; then
    LINTER="biome"
  elif file_exists ".eslintrc" || file_exists ".eslintrc.js" || file_exists ".eslintrc.json" || file_exists ".eslintrc.yml" || contains "package.json" '"eslint"'; then
    LINTER="eslint"
  fi

  # Detect framework
  if contains "package.json" '"next"'; then
    FRAMEWORK="${FRAMEWORK:+$FRAMEWORK, }next.js"
  elif contains "package.json" '"react"'; then
    FRAMEWORK="${FRAMEWORK:+$FRAMEWORK, }react"
  elif contains "package.json" '"vue"'; then
    FRAMEWORK="${FRAMEWORK:+$FRAMEWORK, }vue"
  elif contains "package.json" '"express"' || contains "package.json" '"fastify"' || contains "package.json" '"hono"'; then
    FRAMEWORK="${FRAMEWORK:+$FRAMEWORK, }server"
  fi

  # Detect build tool
  if contains "package.json" '"vite"'; then
    BUILD_TOOL="vite"
  elif contains "package.json" '"esbuild"'; then
    BUILD_TOOL="esbuild"
  elif contains "package.json" '"webpack"'; then
    BUILD_TOOL="webpack"
  elif file_exists "tsconfig.json"; then
    BUILD_TOOL="tsc"
  fi
fi

# --- Go ----------------------------------------------------------------------
if file_exists "go.mod"; then
  LANGUAGE="go"
  PACKAGE_MANAGER="go modules"
  LOCKFILE="go.sum"
  TEST_RUNNER="go test"
  BUILD_TOOL="go build"

  # Detect Go version from go.mod
  LANGUAGE_VERSION="$(grep '^go ' go.mod | awk '{print $2}' | head -1)"
  LANGUAGE_VERSION="${LANGUAGE_VERSION:-unknown}"

  # Detect linter
  if file_exists ".golangci.yml" || file_exists ".golangci.yaml" || file_exists ".golangci.json"; then
    LINTER="golangci-lint"
  fi

  # Detect framework
  if file_exists "go.mod"; then
    if contains "go.mod" "gin-gonic"; then
      FRAMEWORK="gin"
    elif contains "go.mod" "labstack/echo"; then
      FRAMEWORK="echo"
    elif contains "go.mod" "go-chi/chi"; then
      FRAMEWORK="chi"
    elif contains "go.mod" "gofiber/fiber"; then
      FRAMEWORK="fiber"
    fi
  fi
fi

# --- Python ------------------------------------------------------------------
if [[ -z "$LANGUAGE" ]] && { file_exists "pyproject.toml" || file_exists "requirements.txt" || file_exists "setup.py" || file_exists "setup.cfg"; }; then
  LANGUAGE="python"

  # Detect package manager
  if file_exists "poetry.lock"; then
    PACKAGE_MANAGER="poetry"
    LOCKFILE="poetry.lock"
  elif file_exists "uv.lock"; then
    PACKAGE_MANAGER="uv"
    LOCKFILE="uv.lock"
  elif file_exists "Pipfile.lock"; then
    PACKAGE_MANAGER="pipenv"
    LOCKFILE="Pipfile.lock"
  elif file_exists "requirements.txt" || file_exists "requirements-dev.txt"; then
    PACKAGE_MANAGER="pip"
    LOCKFILE="requirements.txt"
  fi

  # Detect Python version
  if file_exists ".python-version"; then
    LANGUAGE_VERSION="$(cat .python-version | tr -d '\n')"
  elif file_exists "pyproject.toml" && command -v grep >/dev/null 2>&1; then
    LANGUAGE_VERSION="$(grep -E 'python_requires|python-requires' pyproject.toml | grep -oE '[0-9]+\.[0-9]+' | head -1)"
  fi
  LANGUAGE_VERSION="${LANGUAGE_VERSION:-3.12 (assumed)}"

  # Detect test runner
  if contains "pyproject.toml" "pytest" || file_exists "pytest.ini" || file_exists "setup.cfg" && contains "setup.cfg" "pytest"; then
    TEST_RUNNER="pytest"
  fi

  # Detect linter
  if file_exists "ruff.toml" || contains "pyproject.toml" '"ruff"' || contains "pyproject.toml" '[tool.ruff]'; then
    LINTER="ruff"
  elif file_exists ".flake8" || contains "setup.cfg" "[flake8]"; then
    LINTER="flake8"
  fi

  # Detect framework
  if contains "pyproject.toml" "fastapi" || contains "requirements.txt" "fastapi"; then
    FRAMEWORK="fastapi"
  elif contains "pyproject.toml" "django" || contains "requirements.txt" "django"; then
    FRAMEWORK="django"
  elif contains "pyproject.toml" "flask" || contains "requirements.txt" "flask"; then
    FRAMEWORK="flask"
  fi
fi

# --- Rust --------------------------------------------------------------------
if [[ -z "$LANGUAGE" ]] && file_exists "Cargo.toml"; then
  LANGUAGE="rust"
  PACKAGE_MANAGER="cargo"
  LOCKFILE="Cargo.lock"
  TEST_RUNNER="cargo test"
  BUILD_TOOL="cargo build"
  LINTER="clippy"

  # Detect Rust version
  if file_exists "rust-toolchain.toml"; then
    LANGUAGE_VERSION="$(grep 'channel' rust-toolchain.toml | grep -oE '"[^"]+"' | tr -d '"')"
  elif file_exists "rust-toolchain"; then
    LANGUAGE_VERSION="$(cat rust-toolchain | tr -d '\n')"
  else
    LANGUAGE_VERSION="stable"
  fi
fi

# --- Docker and build systems (checked regardless of language) ---------------
if file_exists "Dockerfile"; then
  HAS_DOCKER=true
fi

if file_exists "docker-compose.yml" || file_exists "docker-compose.yaml" || file_exists "compose.yml"; then
  HAS_DOCKER_COMPOSE=true
fi

if file_exists "Makefile"; then
  HAS_MAKEFILE=true
  if [[ -z "$BUILD_TOOL" ]]; then
    BUILD_TOOL="make"
  fi
fi

if file_exists "Taskfile.yml" || file_exists "Taskfile.yaml"; then
  HAS_TASKFILE=true
  if [[ -z "$BUILD_TOOL" ]]; then
    BUILD_TOOL="task"
  fi
fi

# ---- Output -----------------------------------------------------------------

echo "=== Stack Detection Results ==="
echo ""
echo "Language:        ${LANGUAGE:-unknown}"
echo "Version:         ${LANGUAGE_VERSION:-unknown}"
echo "Framework:       ${FRAMEWORK:-(none detected)}"
echo "Package Manager: ${PACKAGE_MANAGER:-unknown}"
echo "Lockfile:        ${LOCKFILE:-(none)}"
echo "Test Runner:     ${TEST_RUNNER:-unknown}"
echo "Linter:          ${LINTER:-(none detected)}"
echo "Build Tool:      ${BUILD_TOOL:-(none detected)}"
echo ""
echo "=== Supporting Infrastructure ==="
echo ""
echo "Dockerfile:       $HAS_DOCKER"
echo "Docker Compose:   $HAS_DOCKER_COMPOSE"
echo "Makefile:         $HAS_MAKEFILE"
echo "Taskfile:         $HAS_TASKFILE"
echo ""

if [[ -z "$LANGUAGE" ]]; then
  echo "WARNING: No recognized language detected. Looked for: package.json, go.mod, Cargo.toml, pyproject.toml, requirements.txt, setup.py"
fi
