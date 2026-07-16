# Contributing to RAG Eval Observability

Thank you for your interest in contributing! This document provides guidelines and instructions for contributing to the project.

## Getting Started

1. **Fork the repository** on GitHub
2. **Clone your fork** locally:
   ```bash
   git clone https://github.com/your-username/rag-eval-observe.git
   cd rag-eval-observe
   ```
3. **Set up the development environment** (see README.md for detailed instructions)
4. **Create a branch** for your changes:
   ```bash
   git checkout -b feature/your-feature-name
   ```

## Development Setup

### Prerequisites

- Node.js 18+ and pnpm
- Python 3.11+ and [uv](https://github.com/astral-sh/uv)
- Docker and Docker Compose (for database)

### Setup Steps

1. **Install dependencies:**
   ```bash
   # Frontend
   pnpm install
   
   # Backend
   cd backend && uv sync && cd ..
   ```

2. **Set up environment variables:**
   ```bash
   # Copy example files
   cp .env.example .env.local
   cp backend/.env.example backend/.env
   
   # Edit with your configuration
   ```

3. **Start the database:**
   ```bash
   docker compose up -d postgres
   ```

4. **Run migrations:**
   ```bash
   make migrate
   ```

5. **Start development servers:**
   ```bash
   # Terminal 1: Backend
   make api-dev
   
   # Terminal 2: Frontend
   make dev
   ```

## Making Changes

### Code Style

- **Frontend**: Follow ESLint and Prettier configurations
  ```bash
   pnpm lint        # Check for issues
   pnpm format      # Auto-format code
   ```
- **Backend**: Follow Black and Ruff formatting
  ```bash
   cd backend
   uv run black app/
   uv run ruff check app/
   ```

### Type Safety

- **Frontend**: TypeScript strict mode enabled
  ```bash
   pnpm typecheck   # Verify types
   ```
- **Backend**: Type hints required for all functions

### Testing

- **Frontend**: Run tests before submitting
  ```bash
   pnpm test
   ```
- **Backend**: Run backend tests
  ```bash
   make api-test
   ```

## Pull Request Process

1. **Update documentation** if you've changed functionality
2. **Add tests** for new features or bug fixes
3. **Ensure all tests pass** locally
4. **Run linting** and fix any issues
5. **Commit your changes** with clear, descriptive messages
6. **Push to your fork** and create a Pull Request

### Commit Messages

Use clear, descriptive commit messages:
- `feat: Add document preview feature`
- `fix: Resolve hydration error in ChatPanel`
- `docs: Update API documentation`
- `refactor: Simplify message bubble component`

### Pull Request Checklist

- [ ] Code follows project style guidelines
- [ ] Tests added/updated and passing
- [ ] Documentation updated
- [ ] No console.log statements in production code
- [ ] No hardcoded secrets or API keys
- [ ] TypeScript types are correct
- [ ] Linting passes without errors

## Project Structure

- `src/` - Frontend Next.js application
- `backend/app/` - FastAPI backend application
- `docker/` - Docker configuration and init scripts
- `docs/` - Additional documentation

## Reporting Issues

When reporting bugs or requesting features:

1. **Check existing issues** to avoid duplicates
2. **Use clear titles** and descriptions
3. **Include steps to reproduce** (for bugs)
4. **Provide environment details** (OS, Node/Python versions)
5. **Add labels** if you have permission

## Code Review

All contributions go through code review. Reviewers will check for:
- Code quality and style
- Test coverage
- Documentation completeness
- Security considerations
- Performance implications

## Questions?

Feel free to open an issue for questions or discussions about the project.

Thank you for contributing! 🎉

