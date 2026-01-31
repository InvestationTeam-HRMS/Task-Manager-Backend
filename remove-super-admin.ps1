# Script to remove SUPER_ADMIN references from all TypeScript files
$backendPath = "c:\Users\Gaurav\OneDrive\Documents\Desktop\Mission HRMS\HRMS Backend\src"

Write-Host "Removing SUPER_ADMIN references from backend..." -ForegroundColor Cyan

# Get all .ts files
$files = Get-ChildItem -Path $backendPath -Filter "*.ts" -Recurse

$totalFiles = 0
$modifiedFiles = 0

foreach ($file in $files) {
    $content = Get-Content $file.FullName -Raw
    $originalContent = $content
    
    # Replace patterns
    # Pattern 1: UserRole.ADMIN, UserRole.SUPER_ADMIN -> UserRole.ADMIN
    $content = $content -replace 'UserRole\.ADMIN,\s*UserRole\.SUPER_ADMIN', 'UserRole.ADMIN'
    
    # Pattern 2: UserRole.SUPER_ADMIN, UserRole.ADMIN -> UserRole.ADMIN
    $content = $content -replace 'UserRole\.SUPER_ADMIN,\s*UserRole\.ADMIN', 'UserRole.ADMIN'
    
    # Pattern 3: Standalone UserRole.SUPER_ADMIN (not followed by comma and another role)
    $content = $content -replace 'UserRole\.SUPER_ADMIN(?!,)', 'UserRole.ADMIN'
    
    # Pattern 4: String comparisons 'SUPER_ADMIN' -> 'ADMIN'
    $content = $content -replace "role\s*===\s*['\"]SUPER_ADMIN['\"]", "role === 'ADMIN'"
    $content = $content -replace "role\s*===\s*UserRole\.SUPER_ADMIN", "role === UserRole.ADMIN"
    
    # Pattern 5: Comments mentioning SUPER_ADMIN
    $content = $content -replace 'SUPER_ADMIN', 'ADMIN'
    
    if ($content -ne $originalContent) {
        Set-Content -Path $file.FullName -Value $content -NoNewline
        $modifiedFiles++
        Write-Host "✓ Modified: $($file.Name)" -ForegroundColor Green
    }
    
    $totalFiles++
}

Write-Host "`nSummary:" -ForegroundColor Yellow
Write-Host "Total files scanned: $totalFiles" -ForegroundColor White
Write-Host "Files modified: $modifiedFiles" -ForegroundColor Green
Write-Host "`nDone! All SUPER_ADMIN references have been replaced with ADMIN." -ForegroundColor Cyan
