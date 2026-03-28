$source = "C:\Users\pparedes\OneDrive - Kenmei Technologies\Escritorio\Interference tool\Topologia fisca\inputs_physical_data_4G_2026w03_4G_2026w03_Sedra.csv"
$outPath = "C:\Users\pparedes\OneDrive - Kenmei Technologies\Escritorio\Interference tool\topology-explorer\public\topology.json"

function Parse-Coord($raw, $minVal, $maxVal) {
  if ($null -eq $raw) { return $null }
  $s = "$raw".Trim()
  if ($s.Length -eq 0) { return $null }
  $sign = 1
  if ($s.StartsWith('-')) { $sign = -1 }

  $normalized = $s.Replace(' ', '')
  if ($normalized -match ',' -and $normalized -match '\.') {
    if ($normalized.LastIndexOf(',') -gt $normalized.LastIndexOf('.')) {
      $normalized = $normalized.Replace('.', '')
      $normalized = $normalized.Replace(',', '.')
    } else {
      $normalized = $normalized.Replace(',', '')
    }
  } elseif ($normalized -match ',' -and $normalized -notmatch '\.') {
    $normalized = $normalized.Replace(',', '.')
  }

  try {
    $value = [double]$normalized
    if ($value -ge $minVal -and $value -le $maxVal) { return $value }
  } catch {}

  $digits = ($normalized -replace '[^0-9]', '')
  if ($digits.Length -eq 0) { return $null }

  $candidates = New-Object System.Collections.Generic.List[double]
  for ($p = 3; $p -le 12; $p++) {
    $scaled = $sign * ([double]$digits / [Math]::Pow(10, $p))
    if ($scaled -ge $minVal -and $scaled -le $maxVal) {
      $candidates.Add($scaled) | Out-Null
    }
  }

  if ($candidates.Count -gt 0) {
    return ($candidates | Sort-Object { [Math]::Abs($_) } -Descending | Select-Object -First 1)
  }

  return $null
}

function Parse-Float($raw) {
  if ($null -eq $raw) { return $null }
  $s = "$raw".Trim()
  if ($s.Length -eq 0) { return $null }
  $s = $s.Replace(',', '.')
  try { return [double]$s } catch { return $null }
}

Add-Type -AssemblyName Microsoft.VisualBasic
$parser = New-Object Microsoft.VisualBasic.FileIO.TextFieldParser($source)
$parser.TextFieldType = 'Delimited'
$parser.SetDelimiters(';')
$parser.HasFieldsEnclosedInQuotes = $true

$minLat = 35.0
$maxLat = 44.8
$minLon = -10.5
$maxLon = 5.5

$header = $parser.ReadFields()
$idx = @{
  site_name = [array]::IndexOf($header, 'site_name')
  cell_name = [array]::IndexOf($header, 'cell_name')
  longitude = [array]::IndexOf($header, 'longitude')
  latitude = [array]::IndexOf($header, 'latitude')
  azimuth = [array]::IndexOf($header, 'azimuth')
  vendor = [array]::IndexOf($header, 'vendor')
  technology = [array]::IndexOf($header, 'technology')
  band = [array]::IndexOf($header, 'band')
  province_name = [array]::IndexOf($header, 'province_name')
  municipio_name = [array]::IndexOf($header, 'municipio_name')
  H_Beamwidth = [array]::IndexOf($header, 'H_Beamwidth')
  M_Tilt = [array]::IndexOf($header, 'M_Tilt')
  E_Tilt = [array]::IndexOf($header, 'E_Tilt')
}

$sites = @{}
$cells = New-Object System.Collections.Generic.List[object]

while (-not $parser.EndOfData) {
  $fields = $parser.ReadFields()
  if ($fields.Count -le 1) { continue }

  $siteName = if ($idx.site_name -ge 0) { "$($fields[$idx.site_name])".Trim() } else { '' }
  if ([string]::IsNullOrWhiteSpace($siteName)) { continue }

  $lat = if ($idx.latitude -ge 0) { Parse-Coord $fields[$idx.latitude] $minLat $maxLat } else { $null }
  $lon = if ($idx.longitude -ge 0) { Parse-Coord $fields[$idx.longitude] $minLon $maxLon } else { $null }
  if ($null -eq $lat -or $null -eq $lon) { continue }
  if ($lat -lt $minLat -or $lat -gt $maxLat -or $lon -lt $minLon -or $lon -gt $maxLon) {
    continue
  }

  if (-not $sites.ContainsKey($siteName)) {
    $region = if ($idx.province_name -ge 0) { "$($fields[$idx.province_name])".Trim() } else { '' }
    $city = if ($idx.municipio_name -ge 0) { "$($fields[$idx.municipio_name])".Trim() } else { '' }
    $sites[$siteName] = [ordered]@{
      id = $siteName
      name = $siteName
      lat = $lat
      lon = $lon
      region = if ($region) { $region } else { $null }
      city = if ($city) { $city } else { $null }
    }
  }

  $cellName = if ($idx.cell_name -ge 0) { "$($fields[$idx.cell_name])".Trim() } else { '' }
  if ([string]::IsNullOrWhiteSpace($cellName)) { continue }

  $tilt = if ($idx.M_Tilt -ge 0) { Parse-Float $fields[$idx.M_Tilt] } else { $null }
  if ($null -eq $tilt -and $idx.E_Tilt -ge 0) { $tilt = Parse-Float $fields[$idx.E_Tilt] }

  $cells.Add([ordered]@{
    id = $cellName
    siteId = $siteName
    tech = if ($idx.technology -ge 0) { "$($fields[$idx.technology])".Trim() } else { 'LTE' }
    band = if ($idx.band -ge 0) { "$($fields[$idx.band])".Trim() } else { $null }
    vendor = if ($idx.vendor -ge 0) { "$($fields[$idx.vendor])".Trim() } else { $null }
    hBeamwidth = if ($idx.H_Beamwidth -ge 0) { Parse-Float $fields[$idx.H_Beamwidth] } else { $null }
    azimuth = if ($idx.azimuth -ge 0) { Parse-Float $fields[$idx.azimuth] } else { $null }
    tilt = $tilt
  }) | Out-Null
}
$parser.Close()

$payload = [ordered]@{
  version = "1.0"
  sites = $sites.Values
  cells = $cells
  links = @()
  interferenceSamples = @()
}

$payload | ConvertTo-Json -Depth 6 | Set-Content -Path $outPath
Write-Output ("sites={0} cells={1} -> {2}" -f $payload.sites.Count, $payload.cells.Count, $outPath)
