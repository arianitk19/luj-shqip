import { svg } from "./dom.js";
import swords from "lucide-static/icons/swords.svg?raw";
import users from "lucide-static/icons/users.svg?raw";
import trophy from "lucide-static/icons/trophy.svg?raw";
import user from "lucide-static/icons/user.svg?raw";
import settings from "lucide-static/icons/settings.svg?raw";
import bookOpen from "lucide-static/icons/book-open.svg?raw";
import lock from "lucide-static/icons/lock.svg?raw";
import copy from "lucide-static/icons/copy.svg?raw";
import logOut from "lucide-static/icons/log-out.svg?raw";
import clock from "lucide-static/icons/clock.svg?raw";
import wifiOff from "lucide-static/icons/wifi-off.svg?raw";
import flag from "lucide-static/icons/flag.svg?raw";
import home from "lucide-static/icons/house.svg?raw";
import layers from "lucide-static/icons/layers.svg?raw";

const set = { swords, users, trophy, user, settings, bookOpen, lock, copy, logOut, clock, wifiOff, flag, home, layers };
export const icon = (name, className) => svg(set[name], className);
