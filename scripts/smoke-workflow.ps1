param(
  [string]$ApiBaseUrl = "http://localhost:4000",
  [string]$AppOrigin = "http://localhost:3000"
)

$ErrorActionPreference = "Stop"
$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$email = "signalforge-smoke-$([Guid]::NewGuid().ToString('N'))@example.test"
$bytes = New-Object byte[] 24
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($bytes)
$password = [Convert]::ToBase64String($bytes).Replace("+", "A").Replace("/", "B").TrimEnd("=")
$rng.Dispose()
$slug = "smoke-$([Guid]::NewGuid().ToString('N').Substring(0, 8))"

function Invoke-SignalForgeApi {
  param(
    [string]$Method,
    [string]$Path,
    [object]$Body = $null,
    [hashtable]$ExtraHeaders = @{}
  )
  $headers = @{ Origin = $AppOrigin }
  foreach ($key in $ExtraHeaders.Keys) { $headers[$key] = $ExtraHeaders[$key] }
  $request = @{
    Uri = "$ApiBaseUrl$Path"
    Method = $Method
    Headers = $headers
    WebSession = $session
    ErrorAction = "Stop"
  }
  if ($null -ne $Body) {
    $request.ContentType = "application/json"
    $request.Body = ConvertTo-Json -InputObject $Body -Depth 12 -Compress
  }
  return Invoke-RestMethod @request
}

$null = Invoke-SignalForgeApi -Method POST -Path "/api/auth/sign-up/email" -Body @{ email = $email; password = $password; name = "SignalForge Smoke" }
$actor = Invoke-SignalForgeApi -Method GET -Path "/v1/me"
if ($actor.data.email -ne $email) { throw "Authentication did not return the created account." }

$onboarding = Invoke-SignalForgeApi -Method POST -Path "/v1/onboarding" -Body @{ organizationName = "Smoke Workspace"; projectName = "Checkout Smoke"; projectSlug = $slug }
$organizationId = $onboarding.data.organization.id
$projectId = $onboarding.data.project.id
if (-not $onboarding.data.ingestionKey.StartsWith("sf_live_")) { throw "Onboarding did not issue the scoped ingestion key." }

$null = Invoke-SignalForgeApi -Method POST -Path "/v1/projects/$projectId/demo/failure" -Body @{} -ExtraHeaders @{ "x-organization-id" = $organizationId }
$incidents = @()
for ($attempt = 0; $attempt -lt 30; $attempt += 1) {
  Start-Sleep -Milliseconds 500
  $incidents = @( (Invoke-SignalForgeApi -Method GET -Path "/v1/projects/$projectId/incidents?limit=10" -ExtraHeaders @{ "x-organization-id" = $organizationId }).data )
  if ($incidents.Count -gt 0) { break }
}
if ($incidents.Count -eq 0) { throw "The worker did not correlate the synthetic failure into an incident." }
$incidentId = $incidents[0].id

$investigation = Invoke-SignalForgeApi -Method POST -Path "/v1/incidents/$incidentId/investigations" -Body @{ mode = "evidence_based" } -ExtraHeaders @{ "x-organization-id" = $organizationId }
$investigationId = $investigation.data.id
$investigationResult = $null
for ($attempt = 0; $attempt -lt 30; $attempt += 1) {
  Start-Sleep -Milliseconds 500
  $investigationResult = (Invoke-SignalForgeApi -Method GET -Path "/v1/investigations/$investigationId" -ExtraHeaders @{ "x-organization-id" = $organizationId }).data
  if ($investigationResult.status -in @("completed", "failed")) { break }
}
if ($investigationResult.status -ne "completed") { throw "Investigation ended in status '$($investigationResult.status)' ($($investigationResult.errorCode))." }
$evidence = @( (Invoke-SignalForgeApi -Method GET -Path "/v1/investigations/$investigationId/evidence" -ExtraHeaders @{ "x-organization-id" = $organizationId }).data )
if ($evidence.Count -eq 0) { throw "Investigation completed without persisted evidence." }

$verification = Invoke-SignalForgeApi -Method POST -Path "/v1/incidents/$incidentId/verification-runs" -Body @{ scenarioKey = "recovery-check" } -ExtraHeaders @{ "x-organization-id" = $organizationId }
$verificationId = $verification.data.id
$verificationResult = $null
for ($attempt = 0; $attempt -lt 30; $attempt += 1) {
  Start-Sleep -Milliseconds 500
  $verificationResult = (Invoke-SignalForgeApi -Method GET -Path "/v1/verification-runs/$verificationId" -ExtraHeaders @{ "x-organization-id" = $organizationId }).data
  if ($verificationResult.status -in @("passed", "failed", "error", "timed_out")) { break }
}
if ($verificationResult.status -ne "passed") { throw "Recovery verification ended in status '$($verificationResult.status)' ($($verificationResult.errorCode))." }
$recoveryAssertion = @($verificationResult.report.assertions) | Where-Object { $_.name -eq "sample checkout can query the configured database" } | Select-Object -First 1
if (-not $recoveryAssertion -or -not $recoveryAssertion.passed -or $recoveryAssertion.actual -ne "200 200 CHECKOUT_READY") {
  throw "Recovery verification did not record the sample service's successful database query."
}

[pscustomobject]@{
  Authentication = "passed"
  WorkspaceOnboarding = "passed"
  IncidentCorrelation = "passed"
  Investigation = $investigationResult.status
  PersistedEvidenceCount = $evidence.Count
  Verification = $verificationResult.status
  VerificationAssertion = $recoveryAssertion.actual
  OrganizationId = $organizationId
  ProjectId = $projectId
  IncidentId = $incidentId
  TestUserEmail = $email
} | Format-List
