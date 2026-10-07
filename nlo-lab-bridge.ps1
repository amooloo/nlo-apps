<#
  NLO Lab Bridge  -  tells NLO Cases where each in-house aligner set is in the lab.

  Ortho Factory (the Trimlign software) keeps one folder per order in C:\ProgramData\TrimLignAI\InputFolder (and moves finished
  folders to a "Finished" folder beside it), each with an <id>_<n>_Order.xml listing every aligner and how far it has got. Ortho
  Factory records TRIMMING - sent to the trimmer, then trimmed - not 3D printing or thermoforming (those don't run through it in
  this office; printing reaches NLO Cases from the Formlabs feed instead). This script reads those files (it never changes them),
  counts how many aligners are at the trimmer and trimmed, and sends each order's counts to NLO Cases - sealed with NLO Cases'
  office key, so nothing but the app can read them - using the lab PC's own login. That login can add sealed items to NLO Cases'
  inbox and note when it last checked in. It can't read or change anything.

  Set up once, signed in as the Laboratory user (no administrator needed):
      powershell -NoProfile -ExecutionPolicy Bypass -File "<where you saved it>\nlo-lab-bridge.ps1" -Install
  It asks for the setup code from NLO Cases (Team & security -> Lab PC), checks itself, and starts with Windows (a small
  minimised window called "NLO Lab Bridge"; closing it stops the updates until the next sign-in).

  Other switches:  -SelfTest   checks the encryption on this PC and reads the order files, sends nothing
                   -DryRun     reads the orders and shows exactly what it would send, sends nothing
                   -Once       one pass (send what changed), then stop
                   -Uninstall  stops it starting with Windows and forgets the setup code
  Runs on the Windows PowerShell 5.1 that comes with Windows; nothing to install.
#>
[CmdletBinding()]
param(
  [switch]$Install, [switch]$Uninstall, [switch]$SelfTest, [switch]$DryRun, [switch]$Once, [switch]$TestPlain,
  [string]$DataDir = 'C:\ProgramData\TrimLignAI\InputFolder',
  [string]$AppDir = '',
  [string]$Code = ''
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2
$VER = '2.1'
$POLL_S = 20           # how often the order files are looked at (only files that changed are read again)
$GAP_S = 300           # an order's next update waits this long, unless a step is finished for every aligner
$BEAT_S = 300          # check-in with NLO Cases (Team & security shows it)
$RESEND_S = 24 * 3600  # an order still being made is sent again once a day, in case an update went astray
$ACTIVE_DAYS = 14      # orders Ortho Factory hasn't touched for this long (sets finished long ago) aren't sent
$REFERER = 'https://amooloo.github.io/nlo-apps/nlo-cases.html'
$PROJECT = 'nlo-cases'   # this office's Firebase project (filled in when NLO Cases is built): a setup code for any other is refused
$PLAIN = $TestPlain -and $env:NLO_LAB_TEST_PLAIN -eq '1'   # the tests' unencrypted settings file - never on the lab PC
if (-not $AppDir) { $base = $env:LOCALAPPDATA; if (-not $base) { $base = Join-Path $HOME '.local' }; $AppDir = Join-Path $base 'NLO Lab Bridge' }
if (-not (Test-Path -LiteralPath $AppDir)) { [void](New-Item -ItemType Directory -Path $AppDir -Force) }
$CFG_FILE = Join-Path $AppDir 'config.dat'
$STATE_FILE = Join-Path $AppDir 'state.json'
$LOG_FILE = Join-Path $AppDir 'bridge.log'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch { }

# ---------------------------------------------------------------- log (small, written only when something happens)
function Write-Log([string]$msg) {
  $line = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss') + '  ' + $msg
  Write-Host $line
  try {
    if ((Test-Path -LiteralPath $LOG_FILE) -and ((Get-Item -LiteralPath $LOG_FILE).Length -gt 262144)) { Move-Item -LiteralPath $LOG_FILE -Destination ($LOG_FILE + '.old') -Force }
    [System.IO.File]::AppendAllText($LOG_FILE, $line + [Environment]::NewLine)
  } catch { }
}

# ---------------------------------------------------------------- bytes
function New-RandomBytes([int]$n) { $b = New-Object byte[] $n; $r = [System.Security.Cryptography.RandomNumberGenerator]::Create(); $r.GetBytes($b); $r.Dispose(); return ,$b }
function ConvertTo-B64Url([byte[]]$b) { return [Convert]::ToBase64String($b).TrimEnd('=').Replace('+', '-').Replace('/', '_') }
function ConvertFrom-B64Url([string]$s) { $t = $s.Replace('-', '+').Replace('_', '/'); switch ($t.Length % 4) { 2 { $t += '==' } 3 { $t += '=' } }; return ,([Convert]::FromBase64String($t)) }
function Join-Bytes { $out = New-Object System.Collections.Generic.List[byte]; foreach ($a in $args) { if ($null -ne $a -and $a.Length -gt 0) { $out.AddRange([byte[]]$a) } }; return ,($out.ToArray()) }
function ConvertTo-Hex([byte[]]$b) { return -join ($b | ForEach-Object { $_.ToString('x2') }) }
function ConvertFrom-Hex([string]$h) { $b = New-Object byte[] ($h.Length / 2); for ($i = 0; $i -lt $b.Length; $i++) { $b[$i] = [Convert]::ToByte($h.Substring(2 * $i, 2), 16) }; return ,$b }

# ---------------------------------------------------------------- AES-256-GCM (the same sealing as the app's Crypto.sealTo)
# Windows PowerShell 5.1 runs on .NET Framework, which has AES but not its GCM mode: the counter mode and the GHASH
# authentication are done here with plain AES block encryption, checked against the published test vectors (-SelfTest).
$M32 = [long]4294967295
function Get-Words([byte[]]$b, [int]$o) { $w = New-Object long[] 4; for ($i = 0; $i -lt 4; $i++) { $j = $o + 4 * $i; $w[$i] = ([long]$b[$j] -shl 24) -bor ([long]$b[$j + 1] -shl 16) -bor ([long]$b[$j + 2] -shl 8) -bor [long]$b[$j + 3] }; return ,$w }
function Get-BytesOfWords([long[]]$w) { $b = New-Object byte[] 16; for ($i = 0; $i -lt 4; $i++) { $v = $w[$i]; $b[4 * $i] = [byte](($v -shr 24) -band 255); $b[4 * $i + 1] = [byte](($v -shr 16) -band 255); $b[4 * $i + 2] = [byte](($v -shr 8) -band 255); $b[4 * $i + 3] = [byte]($v -band 255) }; return ,$b }
function Invoke-GfMul([long[]]$x, [long[]]$h) {
  # GCM's multiplication in GF(2^128) (NIST SP 800-38D, algorithm 1), on four 32-bit words
  $z0 = [long]0; $z1 = [long]0; $z2 = [long]0; $z3 = [long]0
  $v0 = $h[0]; $v1 = $h[1]; $v2 = $h[2]; $v3 = $h[3]
  for ($i = 0; $i -lt 128; $i++) {
    $word = $x[$i -shr 5]; $bit = 31 - ($i -band 31)
    if ((($word -shr $bit) -band 1) -eq 1) { $z0 = $z0 -bxor $v0; $z1 = $z1 -bxor $v1; $z2 = $z2 -bxor $v2; $z3 = $z3 -bxor $v3 }
    $lsb = $v3 -band 1
    $v3 = (($v3 -shr 1) -bor (($v2 -band 1) -shl 31)) -band $M32
    $v2 = (($v2 -shr 1) -bor (($v1 -band 1) -shl 31)) -band $M32
    $v1 = (($v1 -shr 1) -bor (($v0 -band 1) -shl 31)) -band $M32
    $v0 = ($v0 -shr 1) -band $M32
    if ($lsb -eq 1) { $v0 = $v0 -bxor [long]3774873600 }   # 0xE1000000
  }
  $r = New-Object long[] 4; $r[0] = $z0; $r[1] = $z1; $r[2] = $z2; $r[3] = $z3; return ,$r
}
function Get-Ghash([long[]]$h, [byte[]]$data) {
  # data is already a whole number of 16-byte blocks
  $y = New-Object long[] 4
  for ($o = 0; $o -lt $data.Length; $o += 16) {
    $blk = Get-Words $data $o
    for ($i = 0; $i -lt 4; $i++) { $y[$i] = $y[$i] -bxor $blk[$i] }
    $y = Invoke-GfMul $y $h
  }
  return ,$y
}
function Get-Padded([byte[]]$b) { if ($null -eq $b -or $b.Length -eq 0) { return ,(New-Object byte[] 0) }; $n = [int][Math]::Ceiling($b.Length / 16) * 16; $p = New-Object byte[] $n; [Array]::Copy($b, $p, $b.Length); return ,$p }
function Get-Len64([long]$bits) { $b = New-Object byte[] 8; for ($i = 7; $i -ge 0; $i--) { $b[$i] = [byte]($bits -band 255); $bits = $bits -shr 8 }; return ,$b }
function Protect-AesGcm([byte[]]$key, [byte[]]$iv, [byte[]]$plain, [byte[]]$aad) {
  if ($iv.Length -ne 12) { throw 'GCM nonce must be 12 bytes' }
  $aes = [System.Security.Cryptography.Aes]::Create(); $aes.Mode = [System.Security.Cryptography.CipherMode]::ECB; $aes.Padding = [System.Security.Cryptography.PaddingMode]::None; $aes.Key = $key
  $enc = $aes.CreateEncryptor()
  try {
    $zero = New-Object byte[] 16; $hB = New-Object byte[] 16; [void]$enc.TransformBlock($zero, 0, 16, $hB, 0); $h = Get-Words $hB 0
    $ctr = New-Object byte[] 16; [Array]::Copy($iv, $ctr, 12)
    $ct = New-Object byte[] $plain.Length; $ks = New-Object byte[] 16; $n = 1
    for ($o = 0; $o -lt $plain.Length; $o += 16) {
      $n++; $ctr[12] = [byte](($n -shr 24) -band 255); $ctr[13] = [byte](($n -shr 16) -band 255); $ctr[14] = [byte](($n -shr 8) -band 255); $ctr[15] = [byte]($n -band 255)
      [void]$enc.TransformBlock($ctr, 0, 16, $ks, 0)
      $m = [Math]::Min(16, $plain.Length - $o); for ($i = 0; $i -lt $m; $i++) { $ct[$o + $i] = $plain[$o + $i] -bxor $ks[$i] }
    }
    $lens = Join-Bytes (Get-Len64 ([long]$aad.Length * 8)) (Get-Len64 ([long]$ct.Length * 8))
    $s = Get-Ghash $h (Join-Bytes (Get-Padded $aad) (Get-Padded $ct) $lens)
    $j0 = New-Object byte[] 16; [Array]::Copy($iv, $j0, 12); $j0[15] = 1
    $ej = New-Object byte[] 16; [void]$enc.TransformBlock($j0, 0, 16, $ej, 0)
    $sB = Get-BytesOfWords $s; $tag = New-Object byte[] 16; for ($i = 0; $i -lt 16; $i++) { $tag[$i] = $sB[$i] -bxor $ej[$i] }
    return ,(Join-Bytes $ct $tag)
  } finally { $enc.Dispose(); $aes.Dispose() }
}
function Get-Hmac256([byte[]]$key, [byte[]]$data) { $h = New-Object System.Security.Cryptography.HMACSHA256 (,$key); try { return ,($h.ComputeHash($data)) } finally { $h.Dispose() } }
# Seal bytes to NLO Cases' inbox public key: ECDH P-256 with a fresh key, HKDF-SHA256 (32 zero bytes of salt, `info`), AES-256-GCM
# (12-byte nonce, `info` as the additional data). The same as Crypto.sealTo in the app and seal.js in the lab-email script.
function Protect-ToInbox([hashtable]$pub, [byte[]]$plain, [string]$info) {
  $curve = [System.Security.Cryptography.ECCurve+NamedCurves]::nistP256
  $q = New-Object System.Security.Cryptography.ECPoint; $q.X = ConvertFrom-B64Url $pub.x; $q.Y = ConvertFrom-B64Url $pub.y
  $pp = New-Object System.Security.Cryptography.ECParameters; $pp.Curve = $curve; $pp.Q = $q
  $peer = [System.Security.Cryptography.ECDiffieHellman]::Create($pp)
  $eph = [System.Security.Cryptography.ECDiffieHellman]::Create($curve)
  try {
    $infoB = [Text.Encoding]::UTF8.GetBytes($info)
    $prk = $eph.DeriveKeyFromHmac($peer.PublicKey, [System.Security.Cryptography.HashAlgorithmName]::SHA256, (New-Object byte[] 32))   # HKDF-Extract
    $okm = Get-Hmac256 $prk (Join-Bytes $infoB ([byte[]]@(1)))                                                                          # HKDF-Expand, 32 bytes
    $iv = New-RandomBytes 12
    $ct = Protect-AesGcm $okm $iv $plain $infoB
    $ep = $eph.ExportParameters($false)
    return @{ epk = @{ kty = 'EC'; crv = 'P-256'; x = (ConvertTo-B64Url $ep.Q.X); y = (ConvertTo-B64Url $ep.Q.Y) }; iv = [Convert]::ToBase64String($iv); ct = [Convert]::ToBase64String($ct) }
  } finally { $peer.Dispose(); $eph.Dispose() }
}
function Test-Crypto {
  # NIST SP 800-38D / McGrew-Viega GCM test case 16 (AES-256, 96-bit nonce, with additional data)
  $k = ConvertFrom-Hex 'feffe9928665731c6d6a8f9467308308feffe9928665731c6d6a8f9467308308'
  $iv = ConvertFrom-Hex 'cafebabefacedbaddecaf888'
  $pt = ConvertFrom-Hex 'd9313225f88406e5a55909c5aff5269a86a7a9531534f7da2e4c303d8a318a721c3c0c95956809532fcf0e2449a6b525b16aedf5aa0de657ba637b39'
  $aad = ConvertFrom-Hex 'feedfacedeadbeeffeedfacedeadbeefabaddad2'
  $want = '522dc1f099567d07f47f37a32a84427d643a8cdcbfe5c0c97598a2bd2555d1aa8cb08e48590dbb3da7b08b1056828838c5f61e6393ba7a0abcc9f662' + '76fc6ece0f4e1768cddf8853bb2d551b'
  $got = ConvertTo-Hex (Protect-AesGcm $k $iv $pt $aad)
  if ($got -ne $want) { throw 'AES-GCM test vector failed on this PC' }
  # an empty message, no additional data (test case 13)
  $got2 = ConvertTo-Hex (Protect-AesGcm (New-Object byte[] 32) (New-Object byte[] 12) (New-Object byte[] 0) (New-Object byte[] 0))
  if ($got2 -ne '530f8afbc74536b9a963b4f1c4cb738b') { throw 'AES-GCM empty-message test failed on this PC' }
  # ECDH + HKDF: a seal to a key made here must give a 65-byte-point key and a ciphertext of the right length
  $mine = [System.Security.Cryptography.ECDiffieHellman]::Create([System.Security.Cryptography.ECCurve+NamedCurves]::nistP256)
  $mp = $mine.ExportParameters($false); $pub = @{ x = (ConvertTo-B64Url $mp.Q.X); y = (ConvertTo-B64Url $mp.Q.Y) }
  $box = Protect-ToInbox $pub ([Text.Encoding]::UTF8.GetBytes('hello')) 'inbox:test'
  if ((ConvertFrom-B64Url $box.epk.x).Length -ne 32 -or ([Convert]::FromBase64String($box.ct)).Length -ne 21) { throw 'ECDH sealing test failed on this PC' }
  $mine.Dispose()
}

# ---------------------------------------------------------------- the setup code and where it's kept (Windows' own per-user encryption)
function Read-SetupCode([string]$s) {
  $s = ($s -replace '\s', '')
  if (-not $s.StartsWith('NLOLAB1.')) { throw 'That is not an NLO Cases lab PC setup code (it starts with NLOLAB1.)' }
  $j = [Text.Encoding]::UTF8.GetString((ConvertFrom-B64Url $s.Substring(8))) | ConvertFrom-Json
  foreach ($k in 'p', 'k', 'e', 'w') { if (-not $j.$k) { throw 'The setup code is incomplete - copy it again from NLO Cases' } }
  if (-not $PROJECT.StartsWith('__') -and [string]$j.p -ne $PROJECT) { throw 'That setup code is for another project, not this office''s NLO Cases - make one in NLO Cases (Team & security -> Lab PC)' }
  foreach ($k in 'ab', 'tb', 'fb') { if ($j.PSObject.Properties[$k] -and $j.$k -and -not ([string]$j.$k -match '^http://(127\.0\.0\.1|localhost)(:\d+)?/')) { throw 'That setup code points somewhere other than NLO Cases - make a new one in NLO Cases' } }
  if (-not ([string]$j.e -match '^labbot\.[a-z0-9]+@')) { throw 'That is not a lab PC setup code - make one in NLO Cases (Team & security -> Lab PC)' }
  return $j
}
function Save-Config($cfg) {
  $json = ConvertTo-Json -InputObject $cfg -Compress -Depth 5
  if ($PLAIN) { [System.IO.File]::WriteAllText($CFG_FILE, 'PLAIN:' + $json); return }
  $sec = ConvertTo-SecureString -String $json -AsPlainText -Force
  [System.IO.File]::WriteAllText($CFG_FILE, (ConvertFrom-SecureString -SecureString $sec))
}
function Get-Config {
  if (-not (Test-Path -LiteralPath $CFG_FILE)) { throw 'Not set up yet - run it once with -Install' }
  $raw = [System.IO.File]::ReadAllText($CFG_FILE)
  if ($raw.StartsWith('PLAIN:')) { if (-not $PLAIN) { throw 'The saved setup code is not encrypted - run -Install again' }; return ($raw.Substring(6) | ConvertFrom-Json) }
  $sec = ConvertTo-SecureString -String $raw
  $p = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
  try { return ([Runtime.InteropServices.Marshal]::PtrToStringBSTR($p) | ConvertFrom-Json) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p) }
}

# ---------------------------------------------------------------- NLO Cases over HTTPS (its Firebase project), as the lab PC's login
$script:Tok = ''; $script:Ref = ''; $script:TokUntil = [DateTime]::MinValue; $script:Office = $null; $script:OfficeAt = [DateTime]::MinValue
function Get-Bases($cfg) {
  $a = 'https://identitytoolkit.googleapis.com/v1'; $t = 'https://securetoken.googleapis.com/v1'; $f = 'https://firestore.googleapis.com/v1'
  if ($cfg.PSObject.Properties['ab'] -and $cfg.ab) { $a = $cfg.ab }; if ($cfg.PSObject.Properties['tb'] -and $cfg.tb) { $t = $cfg.tb }; if ($cfg.PSObject.Properties['fb'] -and $cfg.fb) { $f = $cfg.fb }
  return @{ auth = $a; token = $t; fs = $f }
}
function Invoke-Json([string]$method, [string]$url, $body, [string]$tok) {
  $h = @{ Referer = $REFERER }; if ($tok) { $h.Authorization = 'Bearer ' + $tok }
  $p = @{ Method = $method; Uri = $url; Headers = $h; UseBasicParsing = $true; TimeoutSec = 30 }
  if ($null -ne $body) { $p.ContentType = 'application/json; charset=utf-8'; $p.Body = [Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject $body -Compress -Depth 20)) }
  try { return Invoke-RestMethod @p }
  catch {
    $msg = $_.Exception.Message; $det = ''; try { $det = [string]$_.ErrorDetails.Message } catch { }
    $code = 0; try { $code = [int]$_.Exception.Response.StatusCode } catch { }
    $e = New-Object System.Exception (('HTTP ' + $code + ' ' + $msg + ' ' + $det).Trim()); $e.Data['code'] = $code; $e.Data['body'] = $det; throw $e
  }
}
function Get-Token($cfg) {
  $b = Get-Bases $cfg
  if ($script:Tok -and (Get-Date) -lt $script:TokUntil) { return $script:Tok }
  $r = $null
  if ($script:Ref) { try { $r = Invoke-RestMethod -Method Post -Uri ($b.token + '/token?key=' + [uri]::EscapeDataString($cfg.k)) -Headers @{ Referer = $REFERER } -ContentType 'application/x-www-form-urlencoded' -Body ('grant_type=refresh_token&refresh_token=' + [uri]::EscapeDataString($script:Ref)) -UseBasicParsing -TimeoutSec 30 } catch { $r = $null }
    if ($r) { $script:Tok = $r.id_token; $script:Ref = $r.refresh_token; $script:TokUntil = (Get-Date).AddSeconds([int]$r.expires_in - 300); return $script:Tok } }
  try { $r = Invoke-Json 'Post' ($b.auth + '/accounts:signInWithPassword?key=' + [uri]::EscapeDataString($cfg.k)) @{ email = $cfg.e; password = $cfg.w; returnSecureToken = $true } '' }
  catch { throw ('NLO Cases sign-in failed - if the lab PC was turned off in NLO Cases, make a new setup code there and run -Install again. (' + $_.Exception.Message + ')') }
  $script:Tok = $r.idToken; $script:Ref = $r.refreshToken; $script:TokUntil = (Get-Date).AddSeconds([int]$r.expiresIn - 300)
  return $script:Tok
}
function Get-DocName($cfg, [string]$path) { return 'projects/' + $cfg.p + '/databases/(default)/documents/' + $path }
function Get-Office($cfg) {
  # NLO Cases' inbox key (its public half) and its id - read again every hour in case it changes
  if ($script:Office -and (Get-Date) -lt $script:OfficeAt.AddHours(1)) { return $script:Office }
  $b = Get-Bases $cfg
  $g = Invoke-Json 'Get' ($b.fs + '/' + (Get-DocName $cfg 'meta/inbox')) $null (Get-Token $cfg)
  $f = $g.fields; $pf = $f.pub.mapValue.fields
  $script:Office = @{ kid = [string]$f.kid.stringValue; pub = @{ kty = [string]$pf.kty.stringValue; crv = [string]$pf.crv.stringValue; x = [string]$pf.x.stringValue; y = [string]$pf.y.stringValue } }
  $script:OfficeAt = Get-Date
  return $script:Office
}
function Invoke-Commit($cfg, $writes) {
  $b = Get-Bases $cfg; $url = $b.fs + '/projects/' + $cfg.p + '/databases/(default)/documents:commit'
  try { return Invoke-Json 'Post' $url @{ writes = $writes } (Get-Token $cfg) }
  catch {
    $code = $_.Exception.Data['code']
    if ($code -eq 401 -or $code -eq 403) { $script:Tok = ''; $script:TokUntil = [DateTime]::MinValue; $script:Office = $null; return Invoke-Json 'Post' $url @{ writes = $writes } (Get-Token $cfg) }
    throw
  }
}
function Send-Sealed($cfg, $payload) {
  $o = Get-Office $cfg
  $id = 'm' + (ConvertTo-Hex (New-RandomBytes 20))
  $json = ConvertTo-Json -InputObject $payload -Compress -Depth 20
  $box = Protect-ToInbox $o.pub ([Text.Encoding]::UTF8.GetBytes($json)) ('inbox:' + $id)
  $w = @{ update = @{ name = (Get-DocName $cfg ('inbox/' + $id)); fields = @{
        kid = @{ stringValue = $o.kid }
        epk = @{ mapValue = @{ fields = @{ kty = @{ stringValue = $box.epk.kty }; crv = @{ stringValue = $box.epk.crv }; x = @{ stringValue = $box.epk.x }; y = @{ stringValue = $box.epk.y } } } }
        iv = @{ stringValue = $box.iv }; ct = @{ stringValue = $box.ct } } }
    currentDocument = @{ exists = $false }; updateTransforms = @(@{ fieldPath = 'at'; setToServerValue = 'REQUEST_TIME' }) }
  [void](Invoke-Commit $cfg @($w))
  return $id
}
function Send-Beat($cfg, [string]$beatId, [int]$seen, [int]$sent, [string]$err) {
  $box = ('Lab PC ' + [char]0x00B7 + ' ' + $env:COMPUTERNAME).Trim(); if ($box.Length -gt 120) { $box = $box.Substring(0, 120) }
  if ($err.Length -gt 290) { $err = $err.Substring(0, 290) }
  $w = @{ update = @{ name = (Get-DocName $cfg ('mailbeat/' + $beatId)); fields = @{
        box = @{ stringValue = $box }; seen = @{ integerValue = [string]$seen }; sent = @{ integerValue = [string]$sent }
        err = @{ stringValue = $err }; ver = @{ stringValue = ('lab ' + $VER) } } }
    updateTransforms = @(@{ fieldPath = 'at'; setToServerValue = 'REQUEST_TIME' }) }
  [void](Invoke-Commit $cfg @($w))
}

# ---------------------------------------------------------------- reading Ortho Factory's orders (read-only)
# An order folder's name starts with when it was ordered: "2026-10-05 17 08 17 - A - Dr. ... - <patient> - 1e47". Other folders
# (DreamAlign working folders) are skipped. The file is <OrderData> with a <Patient> child and, beside it, one element per
# aligner/template named <T|A><U|L><number><revision letter>; its State attribute lists, comma-separated, the trim steps it has
# been through. Ortho Factory records trimming only, so each aligner is at one of three levels:
#   0 not at the trimmer yet   1 at the trimmer (State has SentToTrimmer or Barcode)   2 trimmed (State has Trimmed)
$TRIM_AT = @('SentToTrimmer', 'Barcode', 'TrimPathApproved')   # at the trimmer (this office's files use SentToTrimmer / Barcode)
$TRIM_DONE = @('Trimmed')
$script:Seen = @{}   # path -> @{ t = last write time; o = the order read from it }
function Read-OrderXml([string]$path) {
  $fs = [System.IO.File]::Open($path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]'ReadWrite, Delete')
  try {
    $set = New-Object System.Xml.XmlReaderSettings; $set.DtdProcessing = [System.Xml.DtdProcessing]::Ignore; $set.XmlResolver = $null
    $rd = [System.Xml.XmlReader]::Create($fs, $set)
    try { $x = New-Object System.Xml.XmlDocument; $x.XmlResolver = $null; $x.Load($rd); return $x } finally { $rd.Dispose() }
  } finally { $fs.Dispose() }
}
function Get-Order([System.IO.DirectoryInfo]$dir) {
  if ($dir.Name -notmatch '^(\d{4})-(\d{2})-(\d{2}) (\d{2}) (\d{2}) (\d{2})') { return $null }
  $ordered = $matches[1] + '-' + $matches[2] + '-' + $matches[3] + 'T' + $matches[4] + ':' + $matches[5] + ':' + $matches[6]
  $file = Get-ChildItem -LiteralPath $dir.FullName -Filter '*_Order.xml' -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
  if (-not $file) { return $null }
  $prev = $script:Seen[$file.FullName]
  if ($prev -and $prev.t -eq $file.LastWriteTimeUtc.Ticks) { return $prev.o }
  $xml = $null
  for ($try = 0; $try -lt 4; $try++) { try { $xml = Read-OrderXml $file.FullName; break } catch { Start-Sleep -Milliseconds 400 } }   # (Ortho Factory may be writing it)
  if (-not $xml) { if ($prev) { return $prev.o }; return $null }
  $root = $xml.DocumentElement; if (-not $root) { return $null }
  # <OrderData> with a <Patient> child and the aligner elements beside it (an older layout had <Patient> as the root itself)
  $pt = $null
  if ($root.LocalName -eq 'Patient') { $pt = $root }
  else { foreach ($ch in $root.ChildNodes) { if ($ch.NodeType -eq [System.Xml.XmlNodeType]::Element -and $ch.LocalName -eq 'Patient') { $pt = $ch; break } } }
  if (-not $pt) { return $null }
  $items = @{}; $revs = @{}
  foreach ($el in $root.ChildNodes) {
    if ($el.NodeType -ne [System.Xml.XmlNodeType]::Element) { continue }
    if ($el.LocalName -eq 'Patient') { continue }
    # each aligner/template is an <Aligner> element with its code (e.g. AU1D, TU0D) in the Name attribute; an older layout named
    # the element itself by the code. Take the code from the element name, else the Name attribute, else the end of Serialnumber.
    $kind = ''; $arch = ''; $n0 = 0; $rev = ''
    foreach ($cand in @([string]$el.LocalName, ([string]$el.GetAttribute('Name')).Trim(), ([string]$el.GetAttribute('Serialnumber')).Trim())) {
      if ($cand -cmatch '([TA])([UL])([0-9]+)([A-Za-z])$') { $kind = $matches[1]; $arch = $matches[2]; $n0 = [int]$matches[3]; $rev = $matches[4]; break }
    }
    if (-not $kind) { continue }
    $revs[$rev] = 1 + [int]$revs[$rev]
    $states = @(([string]$el.GetAttribute('State')).Split(',') | ForEach-Object { $_.Trim() })
    $lvl = 0
    if (@($states | Where-Object { $TRIM_AT -contains $_ }).Count -gt 0) { $lvl = 1 }
    if (@($states | Where-Object { $TRIM_DONE -contains $_ }).Count -gt 0) { $lvl = 2 }   # trimmed counts "at the trimmer" as done too
    # one physical aligner per kind+arch+number (not per element name): if a number ever appears twice, keep the furthest step
    $ik = $kind + $arch + [string]$n0
    if ($items.ContainsKey($ik)) { if ($lvl -gt $items[$ik].lvl) { $items[$ik].lvl = $lvl } } else { $items[$ik] = @{ k = $kind; arch = $arch; n = $n0; lvl = $lvl } }
  }
  if ($items.Count -eq 0) { return $null }
  $pid0 = ([string]$pt.GetAttribute('ID')).Trim(); if (-not $pid0) { $pid0 = ($file.Name -split '_')[0] }
  $rev = ($revs.GetEnumerator() | Sort-Object Value -Descending | Select-Object -First 1).Key
  $due = ([string]$pt.GetAttribute('DueDate')).Trim(); if ($due -match '^(\d{4})(\d{2})(\d{2})$') { $due = $matches[1] + '-' + $matches[2] + '-' + $matches[3] } else { $due = '' }
  $act = ([DateTimeOffset]$file.LastWriteTimeUtc).ToUnixTimeMilliseconds()   # when Ortho Factory last changed the order
  $o = @{ key = (($pid0 + $rev) -replace '[^A-Za-z0-9_-]', '').ToUpper(); pid = $pid0; rev = [string]$rev
    first = ([string]$pt.GetAttribute('Firstname')).Trim(); last = ([string]$pt.GetAttribute('Lastname')).Trim()
    ordered = $ordered; due = $due; act = [long]$act; items = $items }
  $script:Seen[$file.FullName] = @{ t = $file.LastWriteTimeUtc.Ticks; o = $o }
  return $o
}
# Each aligner's step, by its number (Amir, 6 Oct 2026: "so it can tell you which aligners have been trimmed and which ones haven't"):
# one character per aligner from number 0 up - 0 not at the trimmer yet, 1 at the trimmer, 2 trimmed; '-' for a number the set doesn't have
function Get-Levels($items, [string]$kind, [string]$arch) {
  $max = -1; $lv = @{}
  foreach ($it in $items.Values) { if ($it.k -eq $kind -and $it.arch -eq $arch -and $it.n -ge 0 -and $it.n -le 99) { $lv[[int]$it.n] = [Math]::Min(2, [int]$it.lvl); if ($it.n -gt $max) { $max = [int]$it.n } } }
  if ($max -lt 0) { return '' }
  $sb = New-Object System.Text.StringBuilder
  for ($i = 0; $i -le $max; $i++) { if ($lv.ContainsKey($i)) { [void]$sb.Append([string]$lv[$i]) } else { [void]$sb.Append('-') } }
  return $sb.ToString()
}
# One set, one order: the same set exported again - a reprint, or the rest of the set - lands in another folder with the same order
# number. Its aligners count once, each as far as it has got in any of them; the newest export's name and dates are used.
function Merge-Orders($all) {
  $byKey = @{}
  foreach ($o in $all) {
    $m = $byKey[$o.key]
    if (-not $m) { $m = @{ key = $o.key; pid = $o.pid; rev = $o.rev; first = $o.first; last = $o.last; ordered = $o.ordered; due = $o.due; act = $o.act; items = @{} }; $byKey[$o.key] = $m }
    elseif ([string]$o.ordered -gt [string]$m.ordered) { $m.first = $o.first; $m.last = $o.last; $m.ordered = $o.ordered; $m.due = $o.due }
    if ($o.act -gt $m.act) { $m.act = $o.act }
    foreach ($kv in $o.items.GetEnumerator()) { $p = $m.items[$kv.Key]; if (-not $p -or $kv.Value.lvl -gt $p.lvl) { $m.items[$kv.Key] = $kv.Value } }
  }
  $out = New-Object System.Collections.Generic.List[object]
  foreach ($m in $byKey.Values) {
    $a = @{ n = 0; atTrimmer = 0; trimmed = 0 }; $t = @{ n = 0; atTrimmer = 0; trimmed = 0 }
    $au = 0; $al = 0; $tu = 0; $tl = 0
    foreach ($it in $m.items.Values) {
      $c = $a; if ($it.k -eq 'T') { $c = $t; if ($it.arch -eq 'U') { $tu++ } else { $tl++ } } else { if ($it.arch -eq 'U') { $au++ } else { $al++ } }
      $c.n++; $l = $it.lvl
      if ($l -ge 1) { $c.atTrimmer++ }; if ($l -ge 2) { $c.trimmed++ }
    }
    $lv = [ordered]@{ au = (Get-Levels $m.items 'A' 'U'); al = (Get-Levels $m.items 'A' 'L'); tu = (Get-Levels $m.items 'T' 'U'); tl = (Get-Levels $m.items 'T' 'L') }
    $out.Add([ordered]@{ key = $m.key; pid = $m.pid; rev = $m.rev; first = $m.first; last = $m.last; ordered = $m.ordered; due = $m.due
      au = $au; al = $al; tu = $tu; tl = $tl; a = $a; t = $t; lv = $lv; act = $m.act })
  }
  return ,$out
}
function Get-Orders {
  if (-not (Test-Path -LiteralPath $DataDir)) { throw ('Ortho Factory''s order folder isn''t there: ' + $DataDir) }
  # the live orders are in InputFolder; Ortho Factory moves whole order folders into a "Finished" folder beside it as it goes
  # (being there doesn't mean the set is done), so read both. One order file per folder; a folder read once isn't read again.
  $roots = New-Object System.Collections.Generic.List[string]; $roots.Add($DataDir)
  $fin = Join-Path (Split-Path -Parent $DataDir) 'Finished'; if ((Test-Path -LiteralPath $fin) -and $fin -ne $DataDir) { $roots.Add($fin) }
  $list = New-Object System.Collections.Generic.List[object]; $done = @{}
  foreach ($root in $roots) {
    foreach ($f in (Get-ChildItem -LiteralPath $root -Recurse -Filter '*_Order.xml' -File -ErrorAction SilentlyContinue)) {
      $d = $f.Directory; if (-not $d -or $done.ContainsKey($d.FullName)) { continue }; $done[$d.FullName] = 1
      try { $o = Get-Order $d; if ($o) { $list.Add($o) } } catch { $tag = ($d.Name -split ' - ')[-1]; Write-Log ('Could not read the order folder ending "' + $tag + '"') }
    }
  }
  # keep the parse cache bounded: drop remembered files that have moved or gone (Finished is a growing archive)
  foreach ($p in @($script:Seen.Keys)) { if (-not (Test-Path -LiteralPath $p)) { [void]$script:Seen.Remove($p) } }
  return ,$list
}
function Get-Hash([string]$s) { $h = [System.Security.Cryptography.SHA256]::Create(); try { return (ConvertTo-Hex ($h.ComputeHash([Text.Encoding]::UTF8.GetBytes($s)))).Substring(0, 32) } finally { $h.Dispose() } }
function Get-Sig($o) { $a = $o.a; $t = $o.t; return Get-Hash (@($o.first, $o.last, $o.au, $o.al, $o.tu, $o.tl, $a.n, $a.atTrimmer, $a.trimmed, $t.n, $t.atTrimmer, $t.trimmed, $o.lv.au, $o.lv.al, $o.lv.tu, $o.lv.tl) -join '|') }   # (a hash: no names in state.json)
function Get-Done($o) { $a = $o.a; if ($a.n -le 0) { return '' }; return (@('atTrimmer', 'trimmed') | Where-Object { $a[$_] -ge $a.n }) -join ',' }

# ---------------------------------------------------------------- what was sent (so only changes go out)
function Get-State { if (Test-Path -LiteralPath $STATE_FILE) { try { return ([System.IO.File]::ReadAllText($STATE_FILE) | ConvertFrom-Json) } catch { } }; return $null }
function Save-State($st) { $tmp = $STATE_FILE + '.tmp'; [System.IO.File]::WriteAllText($tmp, (ConvertTo-Json -InputObject $st -Depth 6 -Compress)); Move-Item -LiteralPath $tmp -Destination $STATE_FILE -Force }
function New-State { return [pscustomobject]@{ beat = ('b' + (ConvertTo-Hex (New-RandomBytes 16))); orders = [pscustomobject]@{}; sentToday = 0; day = '' } }

function Invoke-Pass($cfg, $st, [bool]$dry) {
  $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  $orders = Merge-Orders (Get-Orders)
  $send = New-Object System.Collections.Generic.List[object]
  $keys = @{}; $active = 0
  foreach ($o in $orders) {
    $keys[$o.key] = 1
    $sig = Get-Sig $o; $done = Get-Done $o
    $live = ($now - [long]$o.act) -lt ($ACTIVE_DAYS * 86400000)
    $fin = $o.a.n -gt 0 -and $o.a.trimmed -ge $o.a.n
    if ($live) { $active++ }
    $prev = $null; if ($st.orders.PSObject.Properties[$o.key]) { $prev = $st.orders.($o.key) }
    $go = $false
    if (-not $prev) { $go = $live }
    elseif ($prev.sig -ne $sig) {
      $newDone = @($done.Split(',') | Where-Object { $_ -and -not (([string]$prev.done).Split(',') -contains $_) })
      if ($newDone.Count -gt 0 -or ($now - [long]$prev.at) -ge $GAP_S * 1000) { $go = $true }
    }
    elseif ($live -and -not $fin -and ($now - [long]$prev.at) -ge $RESEND_S * 1000) { $go = $true }
    if ($go) { $send.Add(@{ o = $o; sig = $sig; done = $done }) }
  }
  if ($dry) { return @{ orders = $orders; send = $send; active = $active } }
  # one sealed item per 25 orders
  for ($i = 0; $i -lt $send.Count; $i += 25) {
    $batch = @($send | Select-Object -Skip $i -First 25)
    $payload = [ordered]@{ lab = 1; v = 2; src = 'Lab PC'; pc = [string]$env:COMPUTERNAME; ver = $VER; at = $now; orders = @($batch | ForEach-Object { $x = [ordered]@{}; foreach ($k in $_.o.Keys) { $x[$k] = $_.o[$k] }; $x['at'] = $now; $x }) }
    $id = Send-Sealed $cfg $payload
    foreach ($b in $batch) { $st.orders | Add-Member -NotePropertyName $b.o.key -NotePropertyValue ([pscustomobject]@{ sig = $b.sig; done = $b.done; at = $now }) -Force }
    $st.sentToday = [int]$st.sentToday + $batch.Count
    Write-Log ('Sent ' + $batch.Count + ' order update' + $(if ($batch.Count -ne 1) { 's' } else { '' }) + ' (' + (($batch | ForEach-Object { $_.o.key + ' ' + $_.o.a.trimmed + '/' + $_.o.a.n + ' trimmed' }) -join ', ') + ')')
  }
  # orders no longer in the folder (finished and moved out): forgotten
  foreach ($p in @($st.orders.PSObject.Properties)) { if (-not $keys.ContainsKey($p.Name)) { $st.orders.PSObject.Properties.Remove($p.Name) } }
  Save-State $st
  return @{ orders = $orders; send = $send; active = $active }
}

# ---------------------------------------------------------------- the modes
function Show-Orders($res) {
  Write-Host ''
  Write-Host ('Orders in ' + $DataDir + ' (and Finished): ' + $res.orders.Count + ' (' + $res.active + ' changed in the last ' + $ACTIVE_DAYS + ' days - the ones it sends)')
  foreach ($o in $res.orders) {
    $a = $o.a
    Write-Host ('  ' + $o.key.PadRight(12) + ' ' + ($o.first + ' ' + $o.last).PadRight(26) + ' ordered ' + $o.ordered + '  U ' + $o.au + ' L ' + $o.al + ' templates ' + ($o.tu + $o.tl) +
      '  at trimmer ' + $a.atTrimmer + '/' + $a.n + '  trimmed ' + $a.trimmed + '/' + $a.n)
    Write-Host ('               upper ' + $o.lv.au + '   lower ' + $o.lv.al + '   (each aligner from #0: 0 not at the trimmer, 1 at the trimmer, 2 trimmed)')
  }
  Write-Host ('Would send now: ' + $res.send.Count + ' (names travel only inside the sealed update)')
}
function Install-Startup {
  $self = Join-Path $AppDir 'nlo-lab-bridge.ps1'
  if ($PSCommandPath -and ((Resolve-Path -LiteralPath $PSCommandPath).Path -ne $self)) { Copy-Item -LiteralPath $PSCommandPath -Destination $self -Force }
  try { Unblock-File -LiteralPath $self -ErrorAction SilentlyContinue } catch { }
  $startup = [Environment]::GetFolderPath('Startup')
  $lnk = Join-Path $startup 'NLO Lab Bridge.lnk'
  $ws = New-Object -ComObject WScript.Shell
  $sc = $ws.CreateShortcut($lnk)
  $sc.TargetPath = (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe')
  $extra = ''
  if ($DataDir -ne 'C:\ProgramData\TrimLignAI\InputFolder') { $extra += ' -DataDir "' + $DataDir + '"' }
  if ($AppDir -ne (Join-Path $env:LOCALAPPDATA 'NLO Lab Bridge')) { $extra += ' -AppDir "' + $AppDir + '"' }
  $sc.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Minimized -File "' + $self + '"' + $extra
  $sc.WorkingDirectory = $AppDir; $sc.WindowStyle = 7; $sc.Description = 'Sends Ortho Factory progress to NLO Cases'
  $sc.Save()
  return @{ self = $self; lnk = $lnk; ps = $sc.TargetPath; args = $sc.Arguments }
}

if ($MyInvocation.InvocationName -eq '.') { return } # dot-sourced (the tests): just the functions
if ($SelfTest) {
  Test-Crypto; Write-Host 'Encryption: OK (AES-GCM test vectors and ECDH P-256 on this PC)'
  try { Show-Orders (Invoke-Pass $null (New-State) $true) } catch { Write-Host ('Orders: ' + $_.Exception.Message) }
  if (Test-Path -LiteralPath $CFG_FILE) { try { $c = Get-Config; [void](Get-Token $c); [void](Get-Office $c); Write-Host 'NLO Cases: signed in and found the inbox key' } catch { Write-Host ('NLO Cases: ' + $_.Exception.Message) } }
  else { Write-Host 'NLO Cases: not set up yet on this PC (run -Install)' }
  return
}
if ($DryRun) { $st = Get-State; if (-not $st) { $st = New-State }; Show-Orders (Invoke-Pass $null $st $true); return }
if ($Uninstall) {
  $lnk = Join-Path ([Environment]::GetFolderPath('Startup')) 'NLO Lab Bridge.lnk'
  if (Test-Path -LiteralPath $lnk) { Remove-Item -LiteralPath $lnk -Force }
  foreach ($f in @($CFG_FILE, $STATE_FILE, ($STATE_FILE + '.tmp'), $LOG_FILE, ($LOG_FILE + '.old'))) { if (Test-Path -LiteralPath $f) { Remove-Item -LiteralPath $f -Force } }
  Write-Host 'Removed: it no longer starts with Windows, and the setup code and its log are gone from this PC. (A running "NLO Lab Bridge" window stops at the next sign-in, or close it now.)'
  return
}
if ($Install) {
  Write-Host 'NLO Lab Bridge - setup'
  Test-Crypto; Write-Host 'Encryption check: OK'
  if (-not $Code) {   # (the code isn't shown as it's pasted; -Code is for the tests)
    $sec = Read-Host 'Paste the setup code from NLO Cases (Team & security -> Lab PC), then press Enter' -AsSecureString
    $bs = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec); try { $Code = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bs) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bs) }
  }
  $cfg = Read-SetupCode $Code
  [void](Get-Token $cfg); [void](Get-Office $cfg); Write-Host 'Signed in to NLO Cases: OK'
  Save-Config $cfg; Write-Host 'Setup code saved for this Windows user only (encrypted by Windows).'
  $st = New-State; Save-State $st
  Send-Beat $cfg $st.beat 0 0 ''
  if ($env:OS -eq 'Windows_NT') { $i = Install-Startup; Write-Host ('Starts with Windows: ' + $i.lnk); Start-Process -FilePath $i.ps -ArgumentList $i.args -WindowStyle Minimized
    Write-Host 'Started. It shows as a minimised "NLO Lab Bridge" window (one already open picks up the new code by itself). You can close this one.' }
  return
}

# ---------------------------------------------------------------- run: keep watching
$mutex = New-Object System.Threading.Mutex($false, 'Local\NLOLabBridge')
$mine = $false; try { $mine = $mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $mine = $true }
if (-not $mine) { Write-Host 'NLO Lab Bridge is already running on this PC (it picks up a new setup code by itself).'; return }
try { $Host.UI.RawUI.WindowTitle = 'NLO Lab Bridge - sends lab progress to NLO Cases (leave open)' } catch { }
$cfg = Get-Config; $cfgAt = (Get-Item -LiteralPath $CFG_FILE).LastWriteTimeUtc
$st = Get-State; if (-not $st) { $st = New-State }
Test-Crypto
Write-Log ('Started v' + $VER + ', watching ' + $DataDir)
$lastBeat = [DateTime]::MinValue; $lastErr = ''; $errAt = [DateTime]::MinValue
while ($true) {
  # set up again with a new code (-Install): its login and a fresh start
  try { $t = (Get-Item -LiteralPath $CFG_FILE -ErrorAction Stop).LastWriteTimeUtc; if ($t -ne $cfgAt) { $cfg = Get-Config; $cfgAt = $t; $script:Tok = ''; $script:Ref = ''; $script:TokUntil = [DateTime]::MinValue; $script:Office = $null
      $s2 = Get-State; if ($s2) { $st = $s2 }; $lastBeat = [DateTime]::MinValue; Write-Log 'New setup code: signing in with it' } } catch { }
  $today = (Get-Date).ToString('yyyy-MM-dd'); if ($st.day -ne $today) { $st.day = $today; $st.sentToday = 0 }
  $count = 0
  try { $r = Invoke-Pass $cfg $st $false; $count = $r.active; if ($lastErr) { Write-Log 'Working again'; $lastErr = '' } }
  catch { $m = $_.Exception.Message; if ($m -ne $lastErr -or (Get-Date) -gt $errAt.AddMinutes(30)) { Write-Log ('Problem: ' + $m); $errAt = Get-Date }; $lastErr = $m }
  if ((Get-Date) -ge $lastBeat.AddSeconds($BEAT_S)) { try { Send-Beat $cfg $st.beat $count ([int]$st.sentToday) $lastErr; $lastBeat = Get-Date } catch { } }
  if ($Once) { break }
  # turned off in NLO Cases (or a password that no longer works): try again every 5 minutes, not every 20 seconds
  if ($lastErr -match 'HTTP (401|403)|sign-in failed') { Start-Sleep -Seconds 300 } else { Start-Sleep -Seconds $POLL_S }
}
