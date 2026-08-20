# 熊出没集团 · 管理员权限一键打包（electron-builder --win）
# 由 desktop/main 对话触发，日志写入 build.log，完成后写入 build.finished
$ErrorActionPreference = 'Continue'
$env:ELECTRON_MIRROR = 'https://mirrors.huaweicloud.com/electron/'
Set-Location 'D:\Personal\Desktop\03-代码开发\mavis\desktop'

"==== start $(Get-Date -Format o) ====" | Out-File -Encoding utf8 build.log
& node node_modules/electron-builder/out/cli/cli.js --win --dir 2>&1 | Out-File -Encoding utf8 -Append build.log
"==== exit=$LASTEXITCODE $(Get-Date -Format o) ====" | Out-File -Encoding utf8 -Append build.log
Add-Content -Path build.finished -Value "done $LASTEXITCODE"