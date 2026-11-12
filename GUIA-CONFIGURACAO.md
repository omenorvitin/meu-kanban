# Guia de configuração: Meu quadro Kanban

Como configurar o Firebase e executar o projeto em outro computador.

Cada pessoa deve criar o próprio projeto no Firebase e usar a configuração do app Web dele. Não use a senha de outra pessoa nem compartilhe credenciais de usuário.

## O que você vai precisar

- Os arquivos do projeto no computador.
- Uma conta Google para o Firebase Console.
- Visual Studio Code com a extensão Live Server.
- Node.js não é necessário e não é preciso rodar `npm install`.

## Etapa 1: criar e preparar o projeto no Firebase

1. Acesse https://console.firebase.google.com/ e crie um projeto.
2. Adicione um app do tipo Web (ícone `</>`), dê um nome e registre o app.
3. Copie os valores do `firebaseConfig`.
4. Em **Authentication > Método de login**, ative **E-mail/senha**.
5. Em **Firestore Database**, crie o banco em **modo de produção**. A localização não pode ser alterada depois.

Não crie nenhuma coleção. O app cria os documentos de quadros, convites e membros no primeiro acesso.

## Etapa 2: configurar o projeto

Abra `firebase-config.js` e troque os valores pelos do seu `firebaseConfig`. Mantenha o `export const firebaseConfig = { ... };`.

## Etapa 3: publicar as regras do Firestore

1. No Console, abra **Firestore Database > Regras**.
2. Apague o conteúdo, cole o conteúdo de `firestore.rules` e clique em **Publicar**.

As regras permitem que o dono e os editores alterem um quadro. Leitores podem apenas consultar os dados; essa restrição é aplicada no Firestore, não apenas na interface. Convites são associados ao e-mail da conta que os recebe.

## Etapa 4: executar

No VS Code, abra a pasta do projeto e clique em **Go Live** (Live Server). Abrir o `index.html` com duplo clique **não funciona**, porque o projeto usa módulos ES.

## Etapa 5: testar

1. Clique em **Criar conta** e cadastre um e-mail e uma senha de 8 ou mais caracteres.
2. Crie um quadro, adicione uma tarefa e arraste entre as colunas.
3. Abra uma tarefa em **Abrir tarefa**. O link direto tem o formato `/tasks/ID` e pode ser compartilhado com quem tem acesso ao quadro.
4. Em **Compartilhar**, convide uma conta existente como editor ou leitor. O convite é aceito quando essa pessoa entra no app.
5. Teste os papéis: editores podem alterar o quadro; leitores não podem. O dono pode remover o acesso na janela **Compartilhar**.
6. No detalhe da tarefa, teste responsável, prazo, prioridade, labels, checklist, comentários, backlog, sprint, story points e critérios de Scrum.
7. Em **Configurar colunas**, altere os nomes e limites WIP. As mudanças em tarefas são sincronizadas em tempo real com o quadro.
8. Recarregue a página: quadros, tarefas e comentários devem continuar salvos.

## Hospedagem no GitHub Pages

1. Crie um repositório público e envie os arquivos, soltos na raiz, incluindo `404.html` para que links diretos de tarefas abram no GitHub Pages.
2. Em **Settings > Pages**, escolha **Deploy from a branch**, branch **main** e pasta **/ (root)**.
3. Abra o endereço `https://SEU-USUARIO.github.io/NOME-DO-REPOSITORIO/`.

## Problemas comuns

- **permission-denied / "Não foi possível carregar os quadros":** as regras não foram publicadas (Etapa 3) ou o usuário não tem o papel necessário.
- **auth/operation-not-allowed:** o login por E-mail/senha não está ativado (Etapa 1, passo 4).
- **auth/unauthorized-domain:** em **Authentication > Configurações > Domínios autorizados**, adicione `SEU-USUARIO.github.io` (somente o domínio).
- **Tela em branco:** abra pelo Live Server, não com duplo clique no arquivo.
