package com.laolao.classcalendar.core

import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.net.Inet4Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Socket
import java.net.SocketTimeoutException
import java.net.URL
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import javax.net.ssl.HostnameVerifier
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SNIHostName
import javax.net.ssl.SSLException
import javax.net.ssl.SSLSocket
import javax.net.ssl.SSLSocketFactory

/**
 * 自己写的一个小 HTTP 客户端（只用来连我们自己的两台服务器）。
 * 为什么不用系统自带的：模拟器、一些手机的 IPv6 是坏的，系统会先去连 IPv6 地址，一直等到超时；
 * 网页和小程序的浏览器会同时试 IPv4 / IPv6，所以它们能打开、App 却「连接超时」。
 * 这里：先查出全部地址，IPv4 和 IPv6 同时连（IPv4 先出发），谁先连上用谁。
 */
object Http {
    /** 测试时可以换掉（本机自签名证书） */
    var sslFactory: () -> SSLSocketFactory = { SSLSocketFactory.getDefault() as SSLSocketFactory }
    var verifier: HostnameVerifier? = null

    class Timing(var dns: Long = 0, var connect: Long = 0, var tls: Long = 0, var total: Long = 0, var addr: String = "", var addrs: String = "")

    /** 解析域名（带超时，系统的解析没法设超时） */
    fun resolve(host: String, ms: Long): List<InetAddress> {
        val q = LinkedBlockingQueue<Any>()
        Thread { try { q.put(InetAddress.getAllByName(host).toList()) } catch (e: Exception) { q.put(e) } }.apply { isDaemon = true; start() }
        val r = q.poll(ms, TimeUnit.MILLISECONDS) ?: throw SocketTimeoutException("解析域名超时")
        if (r is Exception) throw r
        @Suppress("UNCHECKED_CAST") return r as List<InetAddress>
    }

    /** 同时连几个地址，IPv4 先出发、IPv6 晚 300 毫秒，谁先连上用谁 */
    fun connect(addrs: List<InetAddress>, port: Int, ms: Int): Socket {
        val v4 = addrs.filterIsInstance<Inet4Address>(); val v6 = addrs.filter { it !is Inet4Address }
        val order = mutableListOf<InetAddress>()
        for (i in 0 until maxOf(v4.size, v6.size)) { v4.getOrNull(i)?.let { order += it }; v6.getOrNull(i)?.let { order += it } }
        val list = order.take(4)
        if (list.isEmpty()) throw java.net.UnknownHostException("没有地址")
        val q = LinkedBlockingQueue<Any>()
        val socks = mutableListOf<Socket>()
        list.forEachIndexed { i, a ->
            val s = Socket(); synchronized(socks) { socks += s }
            Thread {
                try { if (i > 0) Thread.sleep(if (a is Inet4Address) 150L * i else 300L + 150L * i); s.connect(InetSocketAddress(a, port), ms); q.put(s) }
                catch (e: Exception) { q.put(e) }
            }.apply { isDaemon = true; start() }
        }
        var err: Exception? = null
        val deadline = System.currentTimeMillis() + ms + 1500
        for (n in list.indices) {
            val left = deadline - System.currentTimeMillis()
            val r = if (left > 0) q.poll(left, TimeUnit.MILLISECONDS) else null
            if (r == null) break
            if (r is Socket) {
                synchronized(socks) { for (o in socks) if (o !== r) try { o.close() } catch (_: Exception) {} }
                return r
            }
            err = r as Exception
        }
        synchronized(socks) { for (o in socks) try { o.close() } catch (_: Exception) {} }
        throw err ?: SocketTimeoutException("连接超时")
    }

    fun send(url: String, method: String, body: ByteArray?, headers: Map<String, String>, connectMs: Int, readMs: Int, t: Timing? = null): Net.Resp {
        val t0 = System.currentTimeMillis()
        val u = URL(url)
        val https = u.protocol == "https"
        val port = if (u.port > 0) u.port else if (https) 443 else 80
        val addrs = resolve(u.host, connectMs.toLong())
        t?.let { it.dns = System.currentTimeMillis() - t0; it.addrs = addrs.joinToString(" ") { a -> a.hostAddress ?: "" } }
        val raw = connect(addrs, port, connectMs)
        t?.let { it.connect = System.currentTimeMillis() - t0 - it.dns; it.addr = raw.inetAddress?.hostAddress ?: "" }
        var sock: Socket = raw
        try {
            raw.soTimeout = readMs
            if (https) {
                val ssl = sslFactory().createSocket(raw, u.host, port, true) as SSLSocket
                try { val p = ssl.sslParameters; p.serverNames = listOf(SNIHostName(u.host)); ssl.sslParameters = p } catch (_: Exception) {}
                ssl.soTimeout = readMs
                val t1 = System.currentTimeMillis()
                ssl.startHandshake()
                t?.let { it.tls = System.currentTimeMillis() - t1 }
                val v = verifier ?: HttpsURLConnection.getDefaultHostnameVerifier()
                if (!v.verify(u.host, ssl.session)) throw SSLException("证书和域名对不上")
                sock = ssl
            }
            val path = (u.path.ifEmpty { "/" }) + if (u.query != null) "?" + u.query else ""
            val sb = StringBuilder()
            sb.append(method).append(' ').append(path).append(" HTTP/1.1\r\n")
            sb.append("Host: ").append(u.host).append(if (u.port > 0) ":" + u.port else "").append("\r\n")
            sb.append("Connection: close\r\nAccept-Encoding: identity\r\nUser-Agent: LaolaoAndroid/7\r\n")
            for ((k, v) in headers) sb.append(k).append(": ").append(v).append("\r\n")
            if (body != null || method == "POST" || method == "PATCH" || method == "PUT") sb.append("Content-Length: ").append(body?.size ?: 0).append("\r\n")
            sb.append("\r\n")
            val out = sock.getOutputStream()
            out.write(sb.toString().toByteArray(Charsets.UTF_8))
            if (body != null) out.write(body)
            out.flush()
            val inp = BufferedInputStream(sock.getInputStream())
            var status: Int
            var hdrs: Map<String, String>
            while (true) {   // 跳过 100 Continue
                val line = readLine(inp) ?: throw java.io.IOException("服务器没有回应")
                status = line.split(' ').getOrNull(1)?.toIntOrNull() ?: throw java.io.IOException("看不懂服务器的回应")
                val h = HashMap<String, String>()
                while (true) { val l = readLine(inp) ?: break; if (l.isEmpty()) break; val i = l.indexOf(':'); if (i > 0) h[l.substring(0, i).trim().lowercase()] = l.substring(i + 1).trim() }
                hdrs = h
                if (status != 100) break
            }
            val bytes = ByteArrayOutputStream()
            val te = hdrs["transfer-encoding"] ?: ""
            val cl = hdrs["content-length"]?.toLongOrNull()
            when {
                method == "HEAD" || status == 204 || status == 304 -> {}
                te.contains("chunked", true) -> {
                    while (true) {
                        val sz = (readLine(inp) ?: break).substringBefore(';').trim().toLongOrNull(16) ?: break
                        if (sz == 0L) break
                        copy(inp, bytes, sz); readLine(inp)
                    }
                }
                cl != null -> copy(inp, bytes, cl)
                else -> { val buf = ByteArray(8192); while (true) { val n = inp.read(buf); if (n < 0) break; bytes.write(buf, 0, n) } }
            }
            t?.let { it.total = System.currentTimeMillis() - t0 }
            return Net.Resp(status, bytes.toString("UTF-8"))
        } finally { try { sock.close() } catch (_: Exception) {} }
    }
    private fun readLine(i: InputStream): String? {
        val b = ByteArrayOutputStream()
        while (true) {
            val c = i.read()
            if (c < 0) return if (b.size() == 0) null else b.toString("UTF-8")
            if (c == '\n'.code) break
            if (c != '\r'.code) b.write(c)
        }
        return b.toString("UTF-8")
    }
    private fun copy(i: InputStream, o: ByteArrayOutputStream, n: Long) {
        var left = n; val buf = ByteArray(8192)
        while (left > 0) { val k = i.read(buf, 0, minOf(buf.size.toLong(), left).toInt()); if (k < 0) throw java.io.EOFException("数据没收全"); o.write(buf, 0, k); left -= k }
    }
}
