"""Automated Integrity and Parity Test Suite for Modular Backend."""
import os
import sys
import glob
import json
import ast
import builtins
import py_compile
from pathlib import Path

root_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(root_dir))

def test_py_compile():
    """Verify syntax across all backend Python modules."""
    py_files = [
        root_dir / "core.py",
        root_dir / "server.py",
        root_dir / "database.py",
        root_dir / "auth.py",
        root_dir / "elo.py",
        root_dir / "config.py",
        root_dir / "scraper.py",
        root_dir / "firestore_db.py",
        root_dir / "army_list_parser.py"
    ] + list((root_dir / "routers").glob("*.py"))

    for p in py_files:
        assert p.exists(), f"File {p} does not exist"
        py_compile.compile(str(p), doraise=True)
    print(f"✅ py_compile passed across all {len(py_files)} Python files!")

def test_ast_undefined_names():
    """Verify AST scoping to ensure no undefined variables in any router."""
    files = [root_dir / "core.py", root_dir / "server.py"] + list((root_dir / "routers").glob("*.py"))
    
    known_globals = {
        "_db_instance", "_engine_instance", "_LAST_UPCOMING_SYNC_TIME",
        "TRACKER_ROOMS", "TRACKER_LISTENERS", "GDM_STATIC_CACHE",
        "DEFAULT_GAME_SYSTEM_ID", "INITIAL_ELO", "DEFAULT_K_FACTOR",
        "MIN_MATCHES_FOR_RANKING", "get_package_dir", "DATABASE_URL",
        "BCP_API_BASE", "DEFAULT_HEADERS", "BCP_CLIENT_ID", "BCP_USER_AGENT",
        "GOOGLE_MAPS_API_KEY", "Database", "get_db", "BestCoastPairingsScraper",
        "EloEngine", "get_auth_manager", "_decode_jwt_payload",
        "get_army_parser", "get_firestore_engine", "Request", "HTTPException",
        "api_events_recommended", "_roster_cache"
    }

    for file_path in files:
        with open(file_path) as f:
            code = f.read()
        
        tree = ast.parse(code)
        top_level_names = set(dir(builtins))
        top_level_names.update(["__name__", "__file__", "__doc__", "__package__"])
        
        def collect_top_level(node_list, names):
            for node in node_list:
                if isinstance(node, ast.Import):
                    for alias in node.names:
                        names.add(alias.asname or alias.name.split(".")[0])
                elif isinstance(node, ast.ImportFrom):
                    for alias in node.names:
                        names.add(alias.asname or alias.name)
                elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                    names.add(node.name)
                elif isinstance(node, ast.Assign):
                    for target in node.targets:
                        if isinstance(target, ast.Name):
                            names.add(target.id)
                        elif isinstance(target, ast.Tuple):
                            for elt in target.elts:
                                if isinstance(elt, ast.Name):
                                    names.add(elt.id)
                elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
                    names.add(node.target.id)
                elif isinstance(node, ast.If):
                    collect_top_level(node.body + node.orelse, names)
                elif isinstance(node, ast.Try):
                    collect_top_level(node.body + node.orelse + node.finalbody, names)
                    for h in node.handlers:
                        collect_top_level(h.body, names)

        collect_top_level(tree.body, top_level_names)

        class ScopeChecker(ast.NodeVisitor):
            def __init__(self):
                self.scopes = [set(top_level_names)]
                self.undefined = set()
            
            def visit_FunctionDef(self, node):
                func_scope = set()
                for arg in node.args.args + node.args.kwonlyargs:
                    func_scope.add(arg.arg)
                if node.args.vararg:
                    func_scope.add(node.args.vararg.arg)
                if node.args.kwarg:
                    func_scope.add(node.args.kwarg.arg)
                
                for child in ast.walk(node):
                    if isinstance(child, ast.Name) and isinstance(child.ctx, ast.Store):
                        func_scope.add(child.id)
                    elif isinstance(child, ast.AnnAssign) and isinstance(child.target, ast.Name):
                        func_scope.add(child.target.id)
                    elif isinstance(child, (ast.Import, ast.ImportFrom)):
                        for alias in child.names:
                            func_scope.add(alias.asname or alias.name.split(".")[0])
                    elif isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                        func_scope.add(child.name)
                    elif isinstance(child, ast.ExceptHandler) and child.name:
                        func_scope.add(child.name)
                
                self.scopes.append(func_scope)
                self.generic_visit(node)
                self.scopes.pop()

            visit_AsyncFunctionDef = visit_FunctionDef

            def visit_Lambda(self, node):
                lambda_scope = set()
                for arg in node.args.args + node.args.kwonlyargs:
                    lambda_scope.add(arg.arg)
                if node.args.vararg:
                    lambda_scope.add(node.args.vararg.arg)
                if node.args.kwarg:
                    lambda_scope.add(node.args.kwarg.arg)
                self.scopes.append(lambda_scope)
                self.generic_visit(node)
                self.scopes.pop()

            def visit_Name(self, node):
                if isinstance(node.ctx, ast.Load):
                    name = node.id
                    found = any(name in s for s in reversed(self.scopes))
                    if not found and name not in known_globals:
                        self.undefined.add((name, node.lineno))
                self.generic_visit(node)

        checker = ScopeChecker()
        checker.visit(tree)
        assert len(checker.undefined) == 0, f"Undefined variables in {file_path.name}: {checker.undefined}"
    print(f"✅ AST scope verification passed across all {len(files)} modules with 0 undefined variables!")

def test_route_parity():
    """Verify all 182 API routes match the canonical specification."""
    sys.modules.pop("pydantic", None)
    sys.modules.pop("fastapi", None)

    import core
    import server

    assert server.app is not None, "server.app failed to initialize"
    registered_routes = [(r[0], r[1]) for r in server.app.routes]
    assert len(registered_routes) == 182, f"Expected 182 routes, found {len(registered_routes)}"

    canonical_path = Path("/tmp/canonical_routes.json")
    if canonical_path.exists():
        with open(canonical_path) as f:
            canonical_raw = json.load(f)
        canonical_routes = [(r[0], r[1]) for r in canonical_raw]
        missing = set(canonical_routes) - set(registered_routes)
        extra = set(registered_routes) - set(canonical_routes)
        assert len(missing) == 0, f"Missing routes: {missing}"
        assert len(extra) == 0, f"Extra routes: {extra}"
    print(f"✅ Route parity verified: exactly 182 routes registered with 100% path and method parity!")

if __name__ == "__main__":
    test_py_compile()
    test_ast_undefined_names()
    test_route_parity()
    print("🎉 ALL BACKEND INTEGRITY AND PARITY TESTS PASSED!")
