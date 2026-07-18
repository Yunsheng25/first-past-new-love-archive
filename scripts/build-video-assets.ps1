[CmdletBinding()]
param(
    [string]$InputVideo,
    [string]$Ffmpeg = 'C:\Users\chenx\AppData\Local\JianyingPro\Apps\10.9.0.14199\ffmpeg.exe',
    [string]$WorkspaceRoot,
    [string]$BackgroundEncoder = 'h264_qsv',
    [ValidatePattern('^\d+[kKmM]$')]
    [string]$BackgroundVideoBitrate = '2500k',
    [switch]$AllowTemporaryWorkspace,
    [switch]$TestFailAfterInstall
)

$ErrorActionPreference = 'Stop'
if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
    $PSNativeCommandUseErrorActionPreference = $false
}

function Get-FullPath([string]$Path) {
    return [System.IO.Path]::GetFullPath($Path)
}

function Test-PathWithin([string]$Candidate, [string]$Parent) {
    $candidateFull = Get-FullPath $Candidate
    $parentFull = (Get-FullPath $Parent).TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
    $prefix = $parentFull + [System.IO.Path]::DirectorySeparatorChar
    return $candidateFull.Equals($parentFull, [System.StringComparison]::OrdinalIgnoreCase) -or
        $candidateFull.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)
}

function Invoke-Ffmpeg([string[]]$Arguments, [string]$Purpose) {
    & $Ffmpeg @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Purpose failed; FFmpeg exited with code $LASTEXITCODE."
    }
}

function Get-SourceState([string]$Path) {
    $item = Get-Item -LiteralPath $Path
    return [pscustomobject]@{
        Length = $item.Length
        LastWriteTimeUtcTicks = $item.LastWriteTimeUtc.Ticks
        Sha256 = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
    }
}

function Assert-SourceUnchanged([string]$Path, $Before) {
    $after = Get-SourceState $Path
    if ($after.Length -ne $Before.Length -or
        $after.LastWriteTimeUtcTicks -ne $Before.LastWriteTimeUtcTicks -or
        $after.Sha256 -ne $Before.Sha256) {
        throw 'Safety check failed: source content or modification time changed.'
    }
}

function Install-OutputsAtomically($Pairs) {
    $backedUp = [System.Collections.Generic.List[object]]::new()
    $installed = [System.Collections.Generic.List[object]]::new()
    try {
        foreach ($pair in $Pairs) {
            if (Test-Path -LiteralPath $pair.Official) {
                Move-Item -LiteralPath $pair.Official -Destination $pair.Backup
                $backedUp.Add($pair)
            }
        }
        foreach ($pair in $Pairs) {
            Move-Item -LiteralPath $pair.Temporary -Destination $pair.Official
            $installed.Add($pair)
        }
    }
    catch {
        foreach ($pair in $installed) {
            if (Test-Path -LiteralPath $pair.Official) {
                Remove-Item -LiteralPath $pair.Official -Force
            }
        }
        foreach ($pair in $backedUp) {
            if (Test-Path -LiteralPath $pair.Backup) {
                Move-Item -LiteralPath $pair.Backup -Destination $pair.Official
            }
        }
        throw
    }
}

function Restore-OutputsAfterInstall($Pairs) {
    $rollbackErrors = [System.Collections.Generic.List[string]]::new()
    foreach ($pair in $Pairs) {
        try {
            if (Test-Path -LiteralPath $pair.Backup) {
                if (Test-Path -LiteralPath $pair.Official) {
                    Remove-Item -LiteralPath $pair.Official -Force
                }
                Move-Item -LiteralPath $pair.Backup -Destination $pair.Official
            }
            elseif (Test-Path -LiteralPath $pair.Official) {
                Remove-Item -LiteralPath $pair.Official -Force
            }
        }
        catch {
            $rollbackErrors.Add("$($pair.Official): $($_.Exception.Message)")
        }
    }
    if ($rollbackErrors.Count -gt 0) {
        throw "Output rollback failed; backups were preserved: $($rollbackErrors -join '; ')"
    }
}

$projectRoot = Get-FullPath (Split-Path -Parent $PSScriptRoot)
if ([string]::IsNullOrWhiteSpace($WorkspaceRoot)) {
    $WorkspaceRoot = $projectRoot
}
if ([string]::IsNullOrWhiteSpace($InputVideo)) {
    $sourceName = -join @(
        [char]0x521D, [char]0x604B, [char]0x65E7,
        [char]0x7231, [char]0x65B0, [char]0x6B22
    )
    $InputVideo = Join-Path 'D:\chenx\Videos' ($sourceName + '.mp4')
}
$workspace = Get-FullPath $WorkspaceRoot
$input = Get-FullPath $InputVideo
$ffmpegPath = Get-FullPath $Ffmpeg

if ($AllowTemporaryWorkspace) {
    $temporaryRoot = Get-FullPath ([System.IO.Path]::GetTempPath())
    $workspaceAllowed = Test-PathWithin $workspace $temporaryRoot
}
else {
    $workspaceAllowed = Test-PathWithin $workspace $projectRoot
}
if (-not $workspaceAllowed) {
    throw "Output workspace must remain inside the project workspace: $projectRoot"
}
if ($TestFailAfterInstall -and -not $AllowTemporaryWorkspace) {
    throw 'TestFailAfterInstall is only allowed with a temporary test workspace.'
}
if (-not (Test-Path -LiteralPath $input -PathType Leaf)) {
    throw "Input video was not found: $input"
}
if (-not (Test-Path -LiteralPath $ffmpegPath -PathType Leaf)) {
    throw "FFmpeg was not found: $ffmpegPath"
}

$outputDirectory = Join-Path $workspace 'assets\video'
$background = Join-Path $outputDirectory 'intro-background.mp4'
$fullFilm = Join-Path $outputDirectory 'full-film.mp4'
if ($input.Equals((Get-FullPath $background), [System.StringComparison]::OrdinalIgnoreCase) -or
    $input.Equals((Get-FullPath $fullFilm), [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'Input/output overlap is not allowed.'
}

New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
$transactionId = [Guid]::NewGuid().ToString('N')
$backgroundTemp = Join-Path $outputDirectory "intro-background.tmp.$transactionId.mp4"
$fullFilmTemp = Join-Path $outputDirectory "full-film.tmp.$transactionId.mp4"
$backgroundBackup = Join-Path $outputDirectory "intro-background.backup.$transactionId.mp4"
$fullFilmBackup = Join-Path $outputDirectory "full-film.backup.$transactionId.mp4"
$pairs = @(
    [pscustomobject]@{ Temporary = $backgroundTemp; Official = $background; Backup = $backgroundBackup },
    [pscustomobject]@{ Temporary = $fullFilmTemp; Official = $fullFilm; Backup = $fullFilmBackup }
)
$sourceBefore = Get-SourceState $input
$transactionInstalled = $false
$transactionCommitted = $false

try {
    $scaleAndSpeed = "scale='min(1280,iw)':'min(720,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,setpts=0.25*PTS"
    $backgroundArguments = @(
        '-hide_banner', '-y',
        '-i', $input,
        '-map', '0:v:0',
        '-an',
        '-vf', $scaleAndSpeed,
        '-c:v', $BackgroundEncoder,
        '-b:v', $BackgroundVideoBitrate,
        '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',
        $backgroundTemp
    )
    Invoke-Ffmpeg $backgroundArguments 'Background video encode'
    if (-not (Test-Path -LiteralPath $backgroundTemp -PathType Leaf) -or (Get-Item $backgroundTemp).Length -le 0) {
        throw 'Background video encode did not create a valid file.'
    }

    $fullFilmArguments = @(
        '-hide_banner', '-y',
        '-i', $input,
        '-map', '0:v:0',
        '-map', '0:a?',
        '-c', 'copy',
        '-movflags', '+faststart',
        $fullFilmTemp
    )
    Invoke-Ffmpeg $fullFilmArguments 'Full-film remux'
    if (-not (Test-Path -LiteralPath $fullFilmTemp -PathType Leaf) -or (Get-Item $fullFilmTemp).Length -le 0) {
        throw 'Full-film remux did not create a valid file.'
    }

    Assert-SourceUnchanged $input $sourceBefore
    Install-OutputsAtomically $pairs
    $transactionInstalled = $true
    if ($TestFailAfterInstall) {
        throw 'Injected post-install failure.'
    }
    Assert-SourceUnchanged $input $sourceBefore
    $transactionCommitted = $true

    Write-Output 'Video assets generated:'
    Write-Output "  $background"
    Write-Output "  $fullFilm"
}
catch {
    $failure = $_
    if ($transactionInstalled -and -not $transactionCommitted) {
        Restore-OutputsAfterInstall $pairs
    }
    throw $failure
}
finally {
    foreach ($pair in $pairs) {
        if (Test-Path -LiteralPath $pair.Temporary) {
            Remove-Item -LiteralPath $pair.Temporary -Force
        }
        if ($transactionCommitted -and (Test-Path -LiteralPath $pair.Backup)) {
            Remove-Item -LiteralPath $pair.Backup -Force
        }
    }
}
