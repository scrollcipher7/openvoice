"use client";
import { useEffect } from "react";
import { StatusBar, Style } from "@capacitor/status-bar";
import { Capacitor } from "@capacitor/core";

export default function NativeInitializer() {
  useEffect(() => {
    if (Capacitor.isNativePlatform()) {
      StatusBar.setBackgroundColor({ color: "#0a0a0a" }).catch(() => {});
      StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
    }
  }, []);
  return null;
}
