#!/bin/bash
# 海螺视频API测试脚本
# 用法: ./test_hailuo.sh YOUR_API_KEY

API_KEY="${1:-}"
if [ -z "$API_KEY" ]; then
  echo "用法: ./test_hailuo.sh YOUR_API_KEY"
  exit 1
fi

API_BASE="https://nexusapi.cn"

echo "=========================================="
echo "测试1: 纯文生视频 (model + prompt + duration)"
echo "=========================================="

RESPONSE=$(curl -s -X POST "${API_BASE}/minimax/v1/video_generation" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${API_KEY}" \
  -d '{
    "model": "MiniMax-Hailuo-02",
    "prompt": "一只可爱的小猫在草地上快乐地奔跑",
    "duration": 6
  }')

echo "响应: $RESPONSE"
echo ""

# 检查是否成功
if echo "$RESPONSE" | grep -q '"status_code":0'; then
  TASK_ID=$(echo "$RESPONSE" | grep -o '"task_id":"[^"]*"' | cut -d'"' -f4)
  echo "✅ 纯文生视频创建成功! task_id: $TASK_ID"
else
  echo "❌ 纯文生视频创建失败"
fi

echo ""
echo "=========================================="
echo "测试2: 纯文生视频（错误参数：额外传 resolution）"
echo "=========================================="

RESPONSE2=$(curl -s -X POST "${API_BASE}/minimax/v1/video_generation" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${API_KEY}" \
  -d '{
    "model": "MiniMax-Hailuo-02",
    "prompt": "一只可爱的小猫在草地上快乐地奔跑",
    "duration": 6,
    "resolution": "768P"
  }')

echo "响应: $RESPONSE2"
echo ""

if echo "$RESPONSE2" | grep -q '"status_code":0'; then
  echo "✅ 成功（resolution 参数被接受）"
else
  echo "❌ 失败（resolution 参数导致错误）"
fi

echo ""
echo "=========================================="
echo "测试3: 纯文生视频（错误参数：额外传 prompt_optimizer）"
echo "=========================================="

RESPONSE3=$(curl -s -X POST "${API_BASE}/minimax/v1/video_generation" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${API_KEY}" \
  -d '{
    "model": "MiniMax-Hailuo-02",
    "prompt": "一只可爱的小猫在草地上快乐地奔跑",
    "duration": 6,
    "prompt_optimizer": true
  }')

echo "响应: $RESPONSE3"
echo ""

if echo "$RESPONSE3" | grep -q '"status_code":0'; then
  echo "✅ 成功（prompt_optimizer 参数被接受）"
else
  echo "❌ 失败（prompt_optimizer 参数导致错误）"
fi

echo ""
echo "=========================================="
echo "测试4: 使用 MiniMax-Hailuo-2.3 模型纯文生（无图片）"
echo "=========================================="

RESPONSE4=$(curl -s -X POST "${API_BASE}/minimax/v1/video_generation" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${API_KEY}" \
  -d '{
    "model": "MiniMax-Hailuo-2.3",
    "prompt": "一只可爱的小猫在草地上快乐地奔跑",
    "duration": 6
  }')

echo "响应: $RESPONSE4"
echo ""

if echo "$RESPONSE4" | grep -q '"status_code":0'; then
  echo "✅ 成功（MiniMax-Hailuo-2.3 支持纯文生）"
else
  echo "❌ 失败（MiniMax-Hailuo-2.3 不支持纯文生）"
fi

echo ""
echo "=========================================="
echo "测试完成"
echo "=========================================="
