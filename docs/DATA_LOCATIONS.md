# Data Locations

This document describes where the packaged (installed) Cutout Studio app keeps its data. A development checkout still stores settings, session and templates inside the repository folder; the installed app uses the layout below.

## Windows Packaged App Root

App data root:

`%LOCALAPPDATA%\Cutout Studio\`

## Suggested Structure

```text
%LOCALAPPDATA%\Cutout Studio\
  config\
    settings.json
  session\
    session.json
  cache\
    previews\
    temp\
    thumbnails\
  models\
    rembg\
    huggingface\
    onnx\
  logs\
  exports\
```

## Rules

- Cache is auto-cleaned.
- Models are not auto-deleted.
- User output is not deleted automatically.
- Settings, sessions, and templates are not cache.
- Logs can be rotated, but should remain available for troubleshooting.

## App Actions

The app can provide:

- Open app data folder
- Clear cache
- Clear downloaded models as an advanced manual action

## Notes

Downloaded models can be large and slow to restore, so they should be excluded from automatic cleanup. User exports and outputs are user data and must require explicit user action before deletion.
