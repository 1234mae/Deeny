$ErrorActionPreference = 'Stop'
$root = [System.IO.Path]::GetFullPath($PSScriptRoot)
$rootPrefix = $root.TrimEnd('\') + '\'
$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add('http://127.0.0.1:8000/')

try {
    $listener.Start()
} catch {
    Write-Error "Unable to start the Islamic app server on port 8000. Close the other app using that port and try again. $($_.Exception.Message)"
    exit 1
}

Write-Output 'Islamic app server listening at http://127.0.0.1:8000/'

$contentTypes = @{
    '.css' = 'text/css; charset=utf-8'
    '.html' = 'text/html; charset=utf-8'
    '.jpg' = 'image/jpeg'
    '.js' = 'text/javascript; charset=utf-8'
    '.mjs' = 'text/javascript; charset=utf-8'
    '.pdf' = 'application/pdf'
    '.png' = 'image/png'
}

while ($listener.IsListening) {
    $context = $listener.GetContext()
    $response = $context.Response

    try {
        $relativePath = [Uri]::UnescapeDataString($context.Request.Url.AbsolutePath.TrimStart('/'))
        if ([string]::IsNullOrWhiteSpace($relativePath)) {
            $relativePath = 'index.html'
        }
        $filePath = [System.IO.Path]::GetFullPath((Join-Path $root $relativePath))
        if (-not $filePath.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
            $response.StatusCode = 403
            continue
        }
        if (-not (Test-Path -LiteralPath $filePath -PathType Leaf)) {
            $response.StatusCode = 404
            continue
        }

        $fileInfo = [System.IO.FileInfo]::new($filePath)
        $response.ContentType = $contentTypes[$fileInfo.Extension.ToLowerInvariant()]
        if (-not $response.ContentType) {
            $response.ContentType = 'application/octet-stream'
        }
        $response.Headers['Accept-Ranges'] = 'bytes'
        $response.Headers['Cache-Control'] = 'no-cache'
        $start = [long]0
        $end = $fileInfo.Length - 1
        $rangeHeader = $context.Request.Headers['Range']

        if ($rangeHeader) {
            if ($rangeHeader -notmatch '^bytes=(\d*)-(\d*)$') {
                $response.StatusCode = 416
                $response.Headers['Content-Range'] = "bytes */$($fileInfo.Length)"
                continue
            }
            if ($Matches[1]) {
                $start = [long]$Matches[1]
                if ($Matches[2]) {
                    $end = [long]$Matches[2]
                }
            } elseif ($Matches[2]) {
                $suffixLength = [long]$Matches[2]
                $start = [Math]::Max(0, $fileInfo.Length - $suffixLength)
            }
            if ($start -gt $end -or $end -ge $fileInfo.Length) {
                $response.StatusCode = 416
                $response.Headers['Content-Range'] = "bytes */$($fileInfo.Length)"
                continue
            }
            $response.StatusCode = 206
            $response.Headers['Content-Range'] = "bytes $start-$end/$($fileInfo.Length)"
        }

        $response.ContentLength64 = $end - $start + 1
        if ($context.Request.HttpMethod -ne 'HEAD') {
            $stream = [System.IO.File]::OpenRead($filePath)
            try {
                [void]$stream.Seek($start, [System.IO.SeekOrigin]::Begin)
                $buffer = [byte[]]::new(65536)
                $remaining = $response.ContentLength64
                while ($remaining -gt 0) {
                    $read = $stream.Read($buffer, 0, [int][Math]::Min($buffer.Length, $remaining))
                    if ($read -eq 0) {
                        throw [System.IO.EndOfStreamException]::new("Unexpected end of file: $filePath")
                    }
                    $response.OutputStream.Write($buffer, 0, $read)
                    $remaining -= $read
                }
            } finally {
                $stream.Dispose()
            }
        }
    } catch {
        Write-Error "Unable to serve $($context.Request.Url.AbsolutePath): $($_.Exception.Message)"
        if (-not $response.OutputStream.CanWrite) {
            continue
        }
        $response.StatusCode = 500
    } finally {
        $response.Close()
    }
}

$listener.Stop()
$listener.Close()
Write-Output 'Islamic app server stopped.'
