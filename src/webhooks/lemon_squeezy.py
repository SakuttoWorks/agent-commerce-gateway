import hashlib
import hmac
import json

from js import Response


async def handle_webhook(request, env):
    """
    Lemon SqueezyからのWebhookを処理するメインハンドラー
    1. 署名検証 (X-Signature)
    2. イベントタイプの判定
    3. 処理の実行
    """

    # 1. Secretの取得確認
    webhook_secret = getattr(env, "LEMON_SQUEEZY_WEBHOOK_SECRET", None)
    if not webhook_secret:
        print("[Error] LEMON_SQUEEZY_WEBHOOK_SECRET is not set.")
        return Response.new("Configuration Error", status=500)

    # 2. ヘッダーから署名を取得
    signature = request.headers.get("X-Signature")
    if not signature:
        return Response.new("Missing Signature", status=401)

    # 3. リクエストボディを取得 (Raw textが必要)
    body_text = await request.text()

    # 4. HMAC-SHA256 で署名を検証
    # Webhookが本物か、改ざんされていないかをチェック
    digest = hmac.new(
        webhook_secret.encode("utf-8"), body_text.encode("utf-8"), hashlib.sha256
    ).hexdigest()

    if not hmac.compare_digest(digest, signature):
        print(f"[Auth Fail] Invalid Signature. Got: {signature}, Calc: {digest}")
        return Response.new("Invalid Signature", status=401)

    # 5. JSONパースとイベント処理
    try:
        payload = json.loads(body_text)
        meta = payload.get("meta", {})
        data = payload.get("data", {})

        event_name = meta.get("event_name")
        custom_data = meta.get("custom_data", {})  # 将来的にユーザーID等をここに入れる

        print(f"[Webhook] Received event: {event_name}")

        # --- イベントごとの処理 (拡張ポイント) ---
        if event_name == "order_created":
            # 注文確定時の処理 (例: データベースに仮登録)
            await process_order_created(data, custom_data, env)

        elif event_name == "subscription_created":
            # サブスク開始時の処理 (例: Pro権限の付与)
            await process_subscription_created(data, custom_data, env)

        elif event_name == "subscription_updated":
            # 更新・解約などの処理
            await process_subscription_updated(data, custom_data, env)

        elif event_name == "license_key_created":
            # ライセンスキー発行時の処理
            await process_license_key(data, env)

        # 6. Lemon Squeezyへ成功レスポンスを返す
        return Response.new("Webhook Received", status=200)

    except Exception as e:
        print(f"[Error] Webhook processing failed: {str(e)}")
        return Response.new("Internal Server Error", status=500)


# ==========================================
# Placeholder Functions (Logic Stubs)
# ==========================================


async def process_order_created(data, custom_data, env):
    # TODO: Supabase等への保存ロジックをここに書く
    attributes = data.get("attributes", {})
    print(f"  -> Order #{data.get('id')} by {attributes.get('user_email')}")
    pass


async def process_subscription_created(data, custom_data, env):
    # TODO: エージェントのステータスを 'active' に変更する
    print(f"  -> Subscription started for ID: {data.get('id')}")
    pass


async def process_subscription_updated(data, custom_data, env):
    attributes = data.get("attributes", {})
    status = attributes.get("status")
    print(f"  -> Subscription {data.get('id')} updated. Status: {status}")
    pass


async def process_license_key(data, env):
    attributes = data.get("attributes", {})
    key = attributes.get("key")
    print(f"  -> License Key Generated: {key}")
    pass
