$body = Get-Content test-request.json -Raw
$response = Invoke-RestMethod -Uri "http://127.0.0.1:4000/mcp" -Method POST -ContentType "application/json" -Body $body
Write-Host $response
