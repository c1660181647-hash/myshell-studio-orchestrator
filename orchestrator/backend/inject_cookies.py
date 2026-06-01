"""Inject MyShell cookies into headless Chrome via CDP.
Reads cookies from: 1) MYSHELL_COOKIES env var, 2) myshell-cookies.json, 3) embedded fallback
"""
import json, os, asyncio, httpx, websockets, time

CDP_URL = "http://127.0.0.1:9222"

def _load_cookies():
    """Load cookies from env, file, or embedded fallback."""
    # 1. Environment variable
    env = os.environ.get("MYSHELL_COOKIES", "")
    if env:
        return json.loads(env)
    
    # 2. External file
    cookie_file = os.path.join(os.path.dirname(__file__), "myshell-cookies.json")
    if os.path.exists(cookie_file):
        with open(cookie_file) as f:
            return json.load(f)
    
    # 3. Embedded fallback
    embedded_file = os.path.join(os.path.dirname(__file__), "myshell_cookies_embedded.json")
    if os.path.exists(embedded_file):
        with open(embedded_file) as f:
            return json.load(f)
    
    return None

async def inject_cookies():
    cookies = _load_cookies()
    if not cookies:
        print("[COOKIES] No cookies found — MyShell bots will not work")
        return False
    
    print(f"[COOKIES] Loaded {len(cookies)} cookies")
    
    # Wait for Chrome
    for i in range(30):
        try:
            pages = httpx.Client().get(f"{CDP_URL}/json", timeout=2).json()
            break
        except:
            time.sleep(1)
    else:
        print("[COOKIES] Chrome not ready after 30s")
        return False
    
    ws_url = pages[0]["webSocketDebuggerUrl"]
    
    async with websockets.connect(ws_url, max_size=10*1024*1024) as ws:
        mid = [0]
        async def cdp(method, params=None):
            mid[0] += 1
            m = {"id": mid[0], "method": method}
            if params: m["params"] = params
            await ws.send(json.dumps(m))
            while True:
                r = json.loads(await ws.recv())
                if r.get("id") == mid[0]: return r
        
        # Navigate to myshell first (cookies need matching domain)
        await cdp("Page.navigate", {"url": "https://art.myshell.ai"})
        await asyncio.sleep(3)
        
        # Inject cookies
        for cookie in cookies:
            params = {
                "name": cookie["name"],
                "value": cookie["value"],
                "domain": cookie.get("domain", ".myshell.ai"),
                "path": cookie.get("path", "/"),
                "secure": cookie.get("secure", True),
                "httpOnly": cookie.get("httpOnly", False),
            }
            if cookie.get("expires", 0) > 0:
                params["expires"] = cookie["expires"]
            if cookie.get("sameSite"):
                params["sameSite"] = cookie["sameSite"]
            
            await cdp("Network.setCookie", params)
        
        print(f"[COOKIES] Injected {len(cookies)} cookies")
        
        # Reload page to apply cookies
        await cdp("Page.navigate", {"url": "https://art.myshell.ai"})
        await asyncio.sleep(5)
        
        # Verify login
        async def ev(expr):
            r = await cdp("Runtime.evaluate", {"expression": expr, "returnByValue": True})
            return r.get("result",{}).get("result",{}).get("value","")
        
        energy = await ev("document.body.innerText.match(/(\\d+)\\s*\\/\\s*(\\d+)/)?.[0] || 'not found'")
        print(f"[COOKIES] Energy display: {energy}")
        
        return "not found" not in energy

if __name__ == "__main__":
    result = asyncio.run(inject_cookies())
    print(f"[COOKIES] {'SUCCESS' if result else 'FAILED'}")
