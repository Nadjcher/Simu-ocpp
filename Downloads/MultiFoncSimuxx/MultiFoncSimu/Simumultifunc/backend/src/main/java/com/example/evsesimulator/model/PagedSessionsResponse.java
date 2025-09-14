package com.example.evsesimulator.model;

import io.swagger.v3.oas.annotations.media.Schema;

import java.util.List;

@Schema(description = "Réponse paginée générique pour les sessions")
public class PagedSessionsResponse<T> {
    @Schema(description = "Nombre total d'éléments")
    private int total;

    @Schema(description = "Limite demandée")
    private int limit;

    @Schema(description = "Décalage (offset) courant")
    private int offset;

    @Schema(description = "Indique s'il existe encore des éléments après ce lot")
    private boolean hasMore;

    @Schema(description = "Prochain offset suggéré")
    private int nextOffset;

    @Schema(description = "Liste des éléments de ce lot")
    private List<T> sessions;

    public PagedSessionsResponse() {}

    public PagedSessionsResponse(int total, int limit, int offset, boolean hasMore, int nextOffset, List<T> sessions) {
        this.total = total;
        this.limit = limit;
        this.offset = offset;
        this.hasMore = hasMore;
        this.nextOffset = nextOffset;
        this.sessions = sessions;
    }

    public int getTotal() { return total; }
    public void setTotal(int total) { this.total = total; }

    public int getLimit() { return limit; }
    public void setLimit(int limit) { this.limit = limit; }

    public int getOffset() { return offset; }
    public void setOffset(int offset) { this.offset = offset; }

    public boolean isHasMore() { return hasMore; }
    public void setHasMore(boolean hasMore) { this.hasMore = hasMore; }

    public int getNextOffset() { return nextOffset; }
    public void setNextOffset(int nextOffset) { this.nextOffset = nextOffset; }

    public List<T> getSessions() { return sessions; }
    public void setSessions(List<T> sessions) { this.sessions = sessions; }
}
