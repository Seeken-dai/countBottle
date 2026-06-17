@echo off
chcp 65001 >nul
echo ==============================================
echo       CountBottle 自动推送与部署脚本
echo ==============================================
echo.

set /p msg="请输入本次更新的说明 (直接敲回车默认提交为: auto update): "
if "%msg%"=="" set msg=auto update

echo.
echo [1/3] 正在添加改动文件到暂存区...
git add .

echo.
echo [2/3] 正在生成提交版本: %msg%...
git commit -m "%msg%"

echo.
echo [3/3] 正在将代码推送到 GitHub (即将触发云端自动部署)...
git push

echo.
echo ==============================================
echo ✅ 推送已完成！
echo 云端服务器正在全自动打包部署中...
echo 你可以前往 GitHub 仓库的 Actions 选项卡查看进度。
echo ==============================================
pause
