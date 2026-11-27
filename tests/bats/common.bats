#!/usr/bin/env bats
# Unit tests for the pure helpers in installer/lib/common.sh.
# Run: bats tests/bats

setup() {
  export MK_LOG="$BATS_TEST_TMPDIR/install.log"
  # common.sh defines its own `run` (log + die on failure), which would replace bats' `run`.
  # Keep bats' version as `brun` for the tests; the installer helpers keep using theirs.
  eval "brun() $(declare -f run | tail -n +2)"
  # shellcheck source=../../installer/lib/common.sh
  source "$BATS_TEST_DIRNAME/../../installer/lib/common.sh"
}

@test "valid_hostname accepts RFC 1123 labels" {
  valid_hostname home-server
  valid_hostname s1
  brun valid_hostname -bad;        [ "$status" -ne 0 ]
  brun valid_hostname Upper;       [ "$status" -ne 0 ]
  brun valid_hostname "a b";       [ "$status" -ne 0 ]
  brun valid_hostname "x;rm -rf";  [ "$status" -ne 0 ]
}

@test "valid_username rejects root and odd names" {
  valid_username home-server
  valid_username _svc
  brun valid_username root;    [ "$status" -ne 0 ]
  brun valid_username 1abc;    [ "$status" -ne 0 ]
  brun valid_username 'a$(id)'; [ "$status" -ne 0 ]
}

@test "valid_timezone needs an existing zoneinfo file and no traversal" {
  valid_timezone Asia/Tashkent
  brun valid_timezone Mars/Olympus;      [ "$status" -ne 0 ]
  brun valid_timezone ../../etc/passwd;  [ "$status" -ne 0 ]
}

@test "valid_cidr checks ranges" {
  valid_cidr 192.168.1.0/24
  valid_cidr 10.0.2.0/24
  brun valid_cidr 300.1.1.1/24;    [ "$status" -ne 0 ]
  brun valid_cidr 10.0.0.0/33;     [ "$status" -ne 0 ]
  brun valid_cidr 10.0.0.0;        [ "$status" -ne 0 ]
}

@test "load_env_file never executes code" {
  f="$BATS_TEST_TMPDIR/c.env"
  printf 'MK_A="$(touch %s/pwned)"\nMK_B=plain\n' "$BATS_TEST_TMPDIR" >"$f"
  load_env_file "$f"
  [ ! -e "$BATS_TEST_TMPDIR/pwned" ]
  [ "$MK_A" = "\$(touch $BATS_TEST_TMPDIR/pwned)" ]
  [ "$MK_B" = plain ]
}

@test "load_env_file ignores unknown keys and keeps env overrides" {
  f="$BATS_TEST_TMPDIR/c.env"
  printf 'PATH=/evil\nMK_HOSTNAME="from-file"\nLD_PRELOAD=x\n' >"$f"
  MK_HOSTNAME=from-env
  load_env_file "$f" 2>/dev/null
  [ "$PATH" != /evil ]
  [ "$MK_HOSTNAME" = from-env ]
  [ -z "${LD_PRELOAD:-}" ]
}

@test "set_env_key adds then replaces" {
  f="$BATS_TEST_TMPDIR/c.env"
  set_env_key "$f" MK_X one
  set_env_key "$f" MK_Y two
  set_env_key "$f" MK_X three
  [ "$(grep -c '^MK_X=' "$f")" -eq 1 ]
  grep -q '^MK_X="three"$' "$f"
  grep -q '^MK_Y="two"$' "$f"
}

@test "set_env_key refuses quotes and newlines" {
  f="$BATS_TEST_TMPDIR/c.env"
  brun set_env_key "$f" MK_X 'a"b'
  [ "$status" -ne 0 ]
}

@test "render_template substitutes MK_ vars literally (incl. & and /)" {
  t="$BATS_TEST_TMPDIR/t"
  printf 'a={{MK_V}}\nb={{MK_MISSING}}\nc={{OTHER}}\n' >"$t"
  MK_V='x&y/z'
  brun render_template "$t"
  [ "$status" -eq 0 ]
  [ "${lines[0]}" = 'a=x&y/z' ]
  [ "${lines[1]}" = 'b=' ]
  [ "${lines[2]}" = 'c={{OTHER}}' ]
}

@test "install_file is idempotent and backs up foreign files" {
  MK_BACKUP_DIR="$BATS_TEST_TMPDIR/bak"
  src="$BATS_TEST_TMPDIR/src"; dst="$BATS_TEST_TMPDIR/etc/x.conf"
  mkdir -p "$(dirname "$dst")"
  echo "original" >"$dst"
  printf '# %s\nnew\n' "$MK_MANAGED_HEADER" >"$src"
  install() { command install -m "$2" "$7" "$8"; }   # no chown in tests
  install_file "$src" "$dst" 0644
  [ "$MK_CHANGES" -eq 1 ]
  ls "$MK_BACKUP_DIR$dst".* >/dev/null
  install_file "$src" "$dst" 0644
  [ "$MK_CHANGES" -eq 1 ]
}

@test "valid_domain accepts registrable domains only" {
  valid_domain mirkomil-host.uz
  valid_domain milano-kafe.uz
  brun valid_domain "*.mirkomil-host.uz"; [ "$status" -ne 0 ]
  brun valid_domain Mirkomil.UZ;         [ "$status" -ne 0 ]
  brun valid_domain localhost;           [ "$status" -ne 0 ]
  brun valid_domain "a..uz";             [ "$status" -ne 0 ]
}

@test "load_env_file succeeds when the last key is already set (re-run regression)" {
  f="$BATS_TEST_TMPDIR/c.env"
  printf 'MK_A="1"
MK_B="2"
' >"$f"
  MK_B=already
  brun load_env_file "$f"
  [ "$status" -eq 0 ]
}

@test "valid_brand allows names, rejects characters that break CSS/INI/env" {
  valid_brand "Mirkomil Host"
  valid_brand "O'zbek Server-1"
  brun valid_brand "A";                 [ "$status" -ne 0 ]
  brun valid_brand 'Bad"Name';          [ "$status" -ne 0 ]
  brun valid_brand 'x}{body';           [ "$status" -ne 0 ]
  brun valid_brand 'a\b';               [ "$status" -ne 0 ]
  brun valid_brand '$(id)';             [ "$status" -ne 0 ]
  brun valid_brand "$(printf 'a%.0s' {1..41})"; [ "$status" -ne 0 ]
}
