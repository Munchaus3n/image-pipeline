# Later Updates

## Preview cache packaging migration
Move preview cache from BASE_DIR/.cache/previews to the app user-data directory before Electron packaging. Avoid creating the cache folder at module import time; create it lazily during preview generation or during controlled app startup with safe error handling.
