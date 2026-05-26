import { getSyncInfo, setSyncInfo } from './sqlite-service';
import {
  parseSnoozeSettingsJson,
  serializeSnoozeSettings,
  snoozeSettingsSyncKey,
  type SnoozeSettings,
} from '../shared/snooze-settings';

export function getSnoozeSettings(): SnoozeSettings {
  return parseSnoozeSettingsJson(getSyncInfo(snoozeSettingsSyncKey()));
}

export function setSnoozeSettings(settings: SnoozeSettings): void {
  setSyncInfo(snoozeSettingsSyncKey(), serializeSnoozeSettings(settings));
}
