package handlers

import (
	"net/http"
	"github.com/example/myapp/pkg/auth"
	"github.com/example/myapp/pkg/db"
)

// Router wraps http.ServeMux with middleware
type Router struct {
	mux *http.ServeMux
}

// NewRouter creates a new Router with registered routes
func NewRouter() *Router {
	r := &Router{mux: http.NewServeMux()}
	r.mux.HandleFunc("/users", r.handleUsers)
	r.mux.HandleFunc("/login", r.handleLogin)
	return r
}

// ServeHTTP implements the http.Handler interface
func (r *Router) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	r.mux.ServeHTTP(w, req)
}

func (r *Router) handleUsers(w http.ResponseWriter, req *http.Request) {
	token, err := auth.Verify(req.Header.Get("Authorization"))
	if err != nil {
		http.Error(w, "unauthorized", 401)
		return
	}
	_ = token
	_ = db.DB
}

func (r *Router) handleLogin(w http.ResponseWriter, req *http.Request) {
	signed, _ := auth.Sign(&auth.Token{UserID: "1", Role: "user"})
	w.Write([]byte(signed))
}
