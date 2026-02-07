#!/bin/bash
# 测试首尾帧视频
API_KEY="sk-ChqGwDKVtrTMlepHFp3YnanMz3H09lv4kvbSloAULBTfV0CM"
API_BASE="https://nexusapi.cn"

# 先上传图片到云雾图床
echo "上传首帧图片..."
FIRST_FRAME_RESP=$(curl -s -X POST "https://imageproxy.zhongzhuan.chat/api/upload" \
  -H "Authorization: Bearer ${API_KEY}" \
  -F "file=@/Users/mac/Desktop/漫剧/测试/首帧.png")
echo "首帧上传响应: $FIRST_FRAME_RESP"

FIRST_URL=$(echo "$FIRST_FRAME_RESP" | grep -o '"url":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "首帧URL: $FIRST_URL"

echo ""
echo "上传尾帧图片..."
LAST_FRAME_RESP=$(curl -s -X POST "https://imageproxy.zhongzhuan.chat/api/upload" \
  -H "Authorization: Bearer ${API_KEY}" \
  -F "file=@/Users/mac/Desktop/漫剧/测试/尾帧.png")
echo "尾帧上传响应: $LAST_FRAME_RESP"

LAST_URL=$(echo "$LAST_FRAME_RESP" | grep -o '"url":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "尾帧URL: $LAST_URL"

if [ -z "$FIRST_URL" ] || [ -z "$LAST_URL" ]; then
  echo "图片上传失败"
  exit 1
fi

echo ""
echo "=========================================="
echo "测试: 首尾帧视频"
echo "=========================================="

PROMPT="超写实电影级3D CG影像，角色伫立在猛烈沙漠沙尘暴中"

RESPONSE=$(curl -s -X POST "${API_BASE}/minimax/v1/video_generation" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${API_KEY}" \
  -d "{
    \"model\": \"MiniMax-Hailuo-2.3\",
    \"prompt\": \"${PROMPT}\",
    \"duration\": 6,
    \"first_frame_image\": \"${FIRST_URL}\",
    \"last_frame_image\": \"${LAST_URL}\",
    \"resolution\": \"768P\",
    \"prompt_optimizer\": true
  }")

echo "响应: $RESPONSE"

if echo "$RESPONSE" | grep -q '"status_code":0'; then
  TASK_ID=$(echo "$RESPONSE" | grep -o '"task_id":"[^"]*"' | cut -d'"' -f4)
  echo "✅ 首尾帧视频创建成功! task_id: $TASK_ID"

  # 等待并查询结果
  echo ""
  echo "等待视频生成..."
  for i in {1..60}; do
    sleep 5
    QUERY_RESP=$(curl -s "${API_BASE}/minimax/v1/query/video_generation?task_id=${TASK_ID}" \
      -H "Authorization: Bearer ${API_KEY}")

    STATUS=$(echo "$QUERY_RESP" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)
    FILE_ID=$(echo "$QUERY_RESP" | grep -o '"file_id":"[^"]*"' | cut -d'"' -f4)

    echo "[$i/60] Status: $STATUS, File: ${FILE_ID:0:50}..."

    if [ "$STATUS" = "Success" ] || [ -n "$FILE_ID" ]; then
      echo ""
      echo "✅ 视频生成成功!"
      echo "完整响应: $QUERY_RESP"
      break
    fi

    if [ "$STATUS" = "Failed" ]; then
      echo "❌ 视频生成失败"
      echo "响应: $QUERY_RESP"
      break
    fi
  done
else
  echo "❌ 首尾帧视频创建失败"
  echo "错误: $RESPONSE"
fi
