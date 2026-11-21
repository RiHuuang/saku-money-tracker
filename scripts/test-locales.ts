// Tests read translated text synchronously, so both dictionaries are registered up front (the app loads one lazily).
import { en } from "../src/locales/en";
import { id } from "../src/locales/id";
import { registerDictionary } from "../src/i18n";

registerDictionary("en", en);
registerDictionary("id", id);
