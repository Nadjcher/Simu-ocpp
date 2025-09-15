package com.example.evsesimulator.tnr;

import com.example.evsesimulator.model.TNREvent;
import com.example.evsesimulator.service.TNRService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.*;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.WebSocketSession;

import java.util.Map;
import java.util.concurrent.CompletableFuture;

@Slf4j
@Aspect
@Component
@Order(200) // faible priorité, n'interfère pas
@RequiredArgsConstructor
public class TNRAspect {

    private final TNRService tnrService;

    /* --------- OCPP client --------- */

    @Around("execution(* com.example.evsesimulator.service.OCPPWebSocketClient.sendOCPPMessage(..)) && args(sessionId, action, payload)")
    public Object aroundSendOcpp(ProceedingJoinPoint pjp, String sessionId, String action, Object payload) throws Throwable {
        recordOcpp("SEND", sessionId, action, payload);
        Object result = pjp.proceed();
        if (result instanceof CompletableFuture<?> f) {
            f.whenComplete((res, ex) -> {
                Object pl = ex == null ? res : Map.of("error", ex.getMessage());
                recordOcpp("RECV", sessionId, action, pl);
            });
        }
        return result;
    }

    @Around("execution(* com.example.evsesimulator.service.OCPPWebSocketClient.startTransaction(..)) && args(sessionId, idTag)")
    public Object aroundStartTx(ProceedingJoinPoint pjp, String sessionId, String idTag) throws Throwable {
        recordOcpp("SEND", sessionId, "StartTransaction", Map.of("idTag", idTag));
        Object result = pjp.proceed();
        if (result instanceof CompletableFuture<?> f) {
            f.whenComplete((res, ex) -> {
                Object pl = ex == null ? res : Map.of("error", ex.getMessage());
                recordOcpp("RECV", sessionId, "StartTransaction", pl);
            });
        }
        return result;
    }

    @Around("execution(* com.example.evsesimulator.service.OCPPWebSocketClient.stopTransaction(..)) && args(sessionId)")
    public Object aroundStopTx(ProceedingJoinPoint pjp, String sessionId) throws Throwable {
        recordOcpp("SEND", sessionId, "StopTransaction", Map.of());
        Object result = pjp.proceed();
        if (result instanceof CompletableFuture<?> f) {
            f.whenComplete((res, ex) -> {
                Object pl = ex == null ? res : Map.of("error", ex.getMessage());
                recordOcpp("RECV", sessionId, "StopTransaction", pl);
            });
        }
        return result;
    }

    private void recordOcpp(String dir, String sessionId, String action, Object payload) {
        try {
            TNREvent ev = new TNREvent();
            ev.setTimestamp(System.currentTimeMillis());
            ev.setSessionId(sessionId);
            ev.setType("ocpp");
            ev.setAction(("RECV".equals(dir) ? "RECV:" : "") + action);
            ev.setPayload(payload);
            tnrService.recordEvent(ev);
        } catch (Exception e) {
            log.debug("TNR ignore (ocpp {} {}): {}", action, dir, e.toString());
        }
    }

    /* --------- Session WS connect/disconnect --------- */

    @After("execution(* com.example.evsesimulator.websocket.SessionWebSocketHandler.afterConnectionEstablished(..)) && args(session)")
    public void afterConnect(WebSocketSession session) {
        recordSession(session, "connect");
    }

    @After("execution(* com.example.evsesimulator.websocket.SessionWebSocketHandler.afterConnectionClosed(..)) && args(session, ..)")
    public void afterDisconnect(WebSocketSession session) {
        recordSession(session, "disconnect");
    }

    private void recordSession(WebSocketSession session, String action) {
        try {
            TNREvent ev = new TNREvent();
            ev.setTimestamp(System.currentTimeMillis());
            ev.setSessionId(session != null ? session.getId() : null);
            ev.setType("session");
            ev.setAction(action);
            ev.setPayload(null);
            tnrService.recordEvent(ev);
        } catch (Exception e) {
            log.debug("TNR ignore (session {}): {}", action, e.toString());
        }
    }
}
