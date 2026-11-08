"""Local preview host; the same plugin files are served by FeedBack in production."""
from pathlib import Path
import importlib.util
from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles

ROOT = Path(__file__).resolve().parent
app = FastAPI(title="Local Open Chart Editor")
spec = importlib.util.spec_from_file_location("oce_local_routes", ROOT / "routes.py")
routes = importlib.util.module_from_spec(spec)
spec.loader.exec_module(routes)
routes.setup(app, {"plugin_dir": str(ROOT)})

@app.get("/", response_class=HTMLResponse)
def index():
    screen = (ROOT / "screen.html").read_text(encoding="utf-8")
    return ('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
            '<title>Open Chart Editor · local build</title><link rel="icon" href="data:,"><link rel="stylesheet" href="/api/plugins/open_chart_editor/assets/editor.css">'
            '<style>html,body{margin:0;height:100%;overflow:hidden}body{background:#1c1c20}</style></head><body>'
            + screen + '<script type="module" src="/api/plugins/open_chart_editor/screen.js"></script></body></html>')

app.mount("/api/plugins/open_chart_editor/src", StaticFiles(directory=ROOT / "src"), name="oce_src")
app.mount("/api/plugins/open_chart_editor/assets", StaticFiles(directory=ROOT / "assets"), name="oce_assets")

@app.get("/api/plugins/open_chart_editor/screen.js")
def entry():
    from fastapi.responses import FileResponse
    return FileResponse(ROOT / "screen.js", media_type="application/javascript")

if __name__ == "__main__":
    import os
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get('OCE_PORT') or os.environ.get('WORKSHOP_PORT') or '8766'))
