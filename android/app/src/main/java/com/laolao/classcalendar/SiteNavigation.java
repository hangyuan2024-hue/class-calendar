package com.laolao.classcalendar;

import java.net.URI;

/** Scheme, host, port and directory boundary match; query/hash do not change ownership. */
final class SiteNavigation {
  static boolean isInternal(String base, String url) {
    try {
      URI b = new URI(base).normalize(), u = new URI(url).normalize();
      if (!"https".equalsIgnoreCase(u.getScheme())
          || u.getUserInfo() != null
          || !b.getHost().equalsIgnoreCase(u.getHost())) return false;
      int port = u.getPort(), bp = b.getPort();
      if ((port == -1 ? 443 : port) != (bp == -1 ? 443 : bp)) return false;
      String p = u.getPath(), path = b.getPath();
      if (p == null || p.contains("\\") || p.contains("/../") || p.contains("/./")) return false;
      if (!path.endsWith("/")) path += "/";
      return p.equals(path.substring(0, path.length() - 1)) || p.startsWith(path);
    } catch (Exception e) {
      return false;
    }
  }
}
