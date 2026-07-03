# Cache Policy

Cutout Studio should keep cache useful without allowing it to grow indefinitely.

## Limits

- Cache max size: 5 GB
- Cleanup target: 4 GB

When cache exceeds 5 GB, delete oldest cache files first until total cache size is at or below 4 GB.

## Cleanup Timing

Run cache cleanup:

- On app startup
- After processing completes
- Periodically while the app is running

## Included In Automatic Cleanup

- Preview cache
- Temporary processing cache
- Thumbnail cache that can be regenerated

## Excluded From Automatic Cleanup

- Downloaded models
- User output
- Exports
- Settings
- Session state
- Templates

## Manual Advanced Actions

The app may provide manual actions for:

- Clear cache
- Clear downloaded models

Clearing downloaded models should be clearly labeled as advanced because the next run may need to download large files again.
